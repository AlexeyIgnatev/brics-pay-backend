const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { NestFactory } = require('@nestjs/core');
const { ConfigService } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { AppModule } = require('../dist/app.module');
const { CryptoService } = require('../dist/config/crypto/crypto.service');
const {
  UsdtTreasuryOrchestratorService,
} = require('../dist/payments/usdt-treasury-orchestrator.service');
const TronWebModule = require('tronweb');

if (!globalThis.crypto) {
  globalThis.crypto = crypto.webcrypto;
}

function getTronWebCtor() {
  const candidate =
    TronWebModule.TronWeb ||
    TronWebModule.default?.TronWeb ||
    TronWebModule.default ||
    TronWebModule;
  if (typeof candidate !== 'function') {
    throw new Error('TronWeb constructor is unavailable');
  }
  return candidate;
}

function requestJson(url, method, body, headers = {}) {
  const target = new URL(url);
  const payload = body ? JSON.stringify(body) : '';
  const requestImpl =
    target.protocol === 'https:' ? https.request : http.request;

  return new Promise((resolve, reject) => {
    const req = requestImpl(
      target,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = data;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {}
          resolve({ status: res.statusCode, data: parsed, raw: data });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`timeout ${url}`));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitTx(rpcUrl, txHash, label) {
  const isConfirmedPayload = (info) => {
    const blockNumber = Number(info?.blockNumber ?? 0);
    if (Number.isFinite(blockNumber) && blockNumber > 0) {
      return true;
    }

    const blockTimeStamp = Number(info?.blockTimeStamp ?? 0);
    const minedTxId =
      typeof info?.id === 'string'
        ? info.id
        : typeof info?.txID === 'string'
          ? info.txID
          : undefined;

    if (
      minedTxId === txHash &&
      Number.isFinite(blockTimeStamp) &&
      blockTimeStamp > 0
    ) {
      return true;
    }

    if (info && Object.keys(info).length > 0 && !('result' in info)) {
      return true;
    }

    return false;
  };

  for (let i = 0; i < 60; i += 1) {
    const [txInfoRes, txRawRes] = await Promise.all([
      requestJson(
        `${rpcUrl.replace(/\/+$/, '')}/wallet/gettransactioninfobyid`,
        'POST',
        { value: txHash },
      ),
      requestJson(
        `${rpcUrl.replace(/\/+$/, '')}/wallet/gettransactionbyid`,
        'POST',
        { value: txHash },
      ),
    ]);

    const txInfo =
      typeof txInfoRes.data === 'object' && txInfoRes.data
        ? txInfoRes.data
        : {};
    const txRaw =
      typeof txRawRes.data === 'object' && txRawRes.data ? txRawRes.data : {};

    if (isConfirmedPayload(txInfo)) {
      console.log(`${label}-confirmed=`, JSON.stringify(txInfo, null, 2));
      return txInfo;
    }

    if (isConfirmedPayload(txRaw)) {
      console.log(`${label}-confirmed-raw=`, JSON.stringify(txRaw, null, 2));
      return txRaw;
    }

    if (i % 10 === 0) {
      console.log(`${label}-poll=`, JSON.stringify({ txInfo, txRaw }, null, 2));
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`${label} confirmation timeout: ${txHash}`);
}

async function sendUsdtTransfer(tron, tokenAddress, fromPrivateKey, toAddress, amount) {
  const amountSun = BigInt(Math.floor(amount * 10 ** 6));
  if (amountSun <= 0n) {
    throw new Error(`Invalid USDT amount: ${amount}`);
  }

  const fromAddress = tron.address.fromPrivateKey(fromPrivateKey);
  const issuerAddressHex = tron.address.toHex(fromAddress);
  const recipientHex = tron.address.toHex(toAddress);

  try {
    const contractInfo = await tron.trx.getContract(tokenAddress);
    console.log(
      'usdt-contract-check=',
      JSON.stringify(
        {
          tokenAddress,
          contractAddress: contractInfo?.contract_address || null,
          originAddress: contractInfo?.origin_address || null,
          name: contractInfo?.name || null,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.log(
      'usdt-contract-check=',
      JSON.stringify(
        {
          tokenAddress,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    throw error;
  }

  const built = await tron.transactionBuilder.triggerSmartContract(
    tokenAddress,
    'transfer(address,uint256)',
    {
      feeLimit: 100_000_000,
      callValue: 0,
    },
    [
      { type: 'address', value: recipientHex },
      { type: 'uint256', value: amountSun.toString() },
    ],
    issuerAddressHex,
  );

  if (!built?.result?.result || !built?.transaction) {
    throw new Error(`Failed to build TRC20 transfer: ${JSON.stringify(built, null, 2)}`);
  }

  const signed = await tron.trx.sign(built.transaction, fromPrivateKey);
  if (!signed?.signature?.length) {
    throw new Error(`Failed to sign TRC20 transfer: ${JSON.stringify(signed, null, 2)}`);
  }

  const broadcast = await tron.trx.sendRawTransaction(signed);
  if (!broadcast?.result && !broadcast?.txid && !broadcast?.transaction?.txID) {
    throw new Error(`Failed to broadcast TRC20 transfer: ${JSON.stringify(broadcast, null, 2)}`);
  }

  return broadcast?.txid || signed?.txID || signed?.transaction?.txID || built?.transaction?.txID;
}

function extractTxResourceNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function extractTxInfoResources(txInfo) {
  const receipt = txInfo?.receipt ?? {};
  const innerReceipt = receipt?.receipt ?? {};

  const feeAmountRaw =
    extractTxResourceNumber(receipt.fee) ||
    extractTxResourceNumber(receipt.net_fee) ||
    extractTxResourceNumber(innerReceipt.net_fee) ||
    extractTxResourceNumber(innerReceipt.fee) ||
    extractTxResourceNumber(receipt.energy_fee) ||
    extractTxResourceNumber(innerReceipt.energy_fee);

  const energyUsed =
    extractTxResourceNumber(receipt.energy_usage_total) ||
    extractTxResourceNumber(receipt.energy_usage) ||
    extractTxResourceNumber(innerReceipt.energy_usage_total) ||
    extractTxResourceNumber(innerReceipt.energy_usage);

  const bandwidthUsed =
    extractTxResourceNumber(receipt.net_usage) ||
    extractTxResourceNumber(innerReceipt.net_usage);

  return {
    fee_amount_raw: feeAmountRaw,
    energy_used: energyUsed,
    bandwidth_used: bandwidthUsed,
  };
}

async function warmUpTreasuryBandwidth({
  TronWebCtor,
  tron,
  tokenAddress,
  treasuryPk,
  treasuryAddress,
  rpcUrl,
  iterations = 25,
}) {
  const probePk = crypto.randomBytes(32).toString('hex');
  const probeAddress = TronWebCtor.address.fromPrivateKey(probePk);
  let lastProbe = null;

  for (let i = 0; i < iterations; i += 1) {
    const probeTx = await sendUsdtTransfer(
      tron,
      tokenAddress,
      treasuryPk,
      probeAddress,
      1,
    );
    const probeInfo = await waitTx(rpcUrl, probeTx, `fee-probe-${i + 1}`);
    const resources = extractTxInfoResources(probeInfo);
    lastProbe = { probeTx, probeInfo, resources };
    console.log(
      `fee-probe-${i + 1}=`,
      JSON.stringify(
        {
          probeTx,
          treasuryAddress,
          probeAddress,
          ...resources,
        },
        null,
        2,
      ),
    );
    if (resources.fee_amount_raw > 0) {
      return lastProbe;
    }
  }

  return lastProbe;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const prisma = app.get(PrismaClient);
    const configService = app.get(ConfigService);
    const cryptoService = app.get(CryptoService);

    const orchestrator = new UsdtTreasuryOrchestratorService(
      prisma,
      configService,
      cryptoService,
      null,
    );

    const rpcUrl =
      process.env.TRON_FULL_NODE ||
      process.env.USDT_RPC_URL ||
      'http://172.17.0.1:8090';
    const appUrl = process.env.APP_URL || 'http://127.0.0.1:8000';
    const tokenAddress =
      process.env.USDT_TOKEN_ADDRESS || process.env.TRON_USDT_CONTRACT;
    const webhookSecret = fs
      .readFileSync('/run/secrets/usdt_webhook_secret', 'utf8')
      .trim();
    const treasuryPk = fs
      .readFileSync('/run/secrets/usdt_treasury_private_key', 'utf8')
      .trim();

    const TronWebCtor = getTronWebCtor();
    const tron = new TronWebCtor({ fullHost: rpcUrl, privateKey: treasuryPk });
    const treasuryAddress = TronWebCtor.address.fromPrivateKey(treasuryPk);
    if (!tokenAddress) {
      throw new Error('USDT_TOKEN_ADDRESS is required');
    }
    console.log('tokenAddress=', tokenAddress);

    const customers = [
      { id: 2566667, address: 'TB2vZNBU4CAhpXwfixd5DFMmdVp8V2LpWn' },
      { id: 2566678, address: 'TXF8XYkW9SePRjEnWpNaF4yHevopj7jFUp' },
    ];

    const tokenContractPreview = await tron.trx.getContract(tokenAddress).catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
    console.log('tokenContractPreview=', JSON.stringify(tokenContractPreview, null, 2));

    const runId = String(Date.now());
    const startedAt = new Date();

    const beforeBalances = await prisma.userAssetBalance.findMany({
      where: {
        customer_id: { in: customers.map((c) => c.id) },
        asset: 'USDT_TRC20',
      },
      orderBy: { customer_id: 'asc' },
      select: { customer_id: true, asset: true, balance: true },
    });

    console.log('runId=', runId);
    console.log('rpcUrl=', rpcUrl);
    console.log('beforeBalances=', JSON.stringify(beforeBalances, null, 2));

    const feeWarmup = await warmUpTreasuryBandwidth({
      TronWebCtor,
      tron,
      tokenAddress,
      treasuryPk,
      treasuryAddress,
      rpcUrl,
      iterations: 30,
    });
    console.log('feeWarmup=', JSON.stringify(feeWarmup, null, 2));

    const tx1 = await sendUsdtTransfer(
      tron,
      tokenAddress,
      treasuryPk,
      customers[0].address,
      11,
    );

    if (!tx1) {
      throw new Error(`deposit tx missing: ${JSON.stringify({ tokenAddress }, null, 2)}`);
    }

    console.log(
      'deposit-1-send=',
      JSON.stringify({ txid: tx1, tokenAddress, to: customers[0].address }, null, 2),
    );
    await waitTx(rpcUrl, tx1, 'deposit-1');

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const tx2 = await sendUsdtTransfer(
      tron,
      tokenAddress,
      treasuryPk,
      customers[1].address,
      11,
    );

    if (!tx2) {
      throw new Error(`deposit tx missing: ${JSON.stringify({ tokenAddress }, null, 2)}`);
    }

    console.log(
      'deposit-2-send=',
      JSON.stringify({ txid: tx2, tokenAddress, to: customers[1].address }, null, 2),
    );
    await waitTx(rpcUrl, tx2, 'deposit-2');

    const webhook1 = await requestJson(
      `${appUrl}/payments/usdt/deposit-webhook`,
      'POST',
      {
        tx_hash: tx1,
        from_address: treasuryAddress,
        to_address: customers[0].address,
        amount: 11,
        idempotency_key: `dep-${runId}-1`,
        payload: { runId, source: 'private-chain-full-test' },
      },
      { 'x-webhook-secret': webhookSecret },
    );

    const webhook1Dup = await requestJson(
      `${appUrl}/payments/usdt/deposit-webhook`,
      'POST',
      {
        tx_hash: tx1,
        from_address: treasuryAddress,
        to_address: customers[0].address,
        amount: 11,
        idempotency_key: `dep-${runId}-1-dup`,
        payload: { runId, source: 'private-chain-full-test-dup' },
      },
      { 'x-webhook-secret': webhookSecret },
    );

    const webhook2 = await requestJson(
      `${appUrl}/payments/usdt/deposit-webhook`,
      'POST',
      {
        tx_hash: tx2,
        from_address: treasuryAddress,
        to_address: customers[1].address,
        amount: 11,
        idempotency_key: `dep-${runId}-2`,
        payload: { runId, source: 'private-chain-full-test' },
      },
      { 'x-webhook-secret': webhookSecret },
    );

    console.log('deposit-webhook-1=', JSON.stringify(webhook1, null, 2));
    console.log('deposit-webhook-1-dup=', JSON.stringify(webhook1Dup, null, 2));
    console.log('deposit-webhook-2=', JSON.stringify(webhook2, null, 2));

    const internalTransfer = await orchestrator.processInternalTransfer({
      senderCustomerId: customers[0].id,
      receiverCustomerId: customers[1].id,
      amount: 5,
      senderAddress: customers[0].address,
      receiverAddress: customers[1].address,
      idempotencyKey: `internal-${runId}`,
      payload: { runId, source: 'private-chain-full-test' },
    });

    console.log(
      'internal-transfer=',
      JSON.stringify(internalTransfer, null, 2),
    );

    const withdrawPk = crypto.randomBytes(32).toString('hex');
    const withdrawAddress = TronWebCtor.address.fromPrivateKey(withdrawPk);

    try {
      const withdrawResult = await orchestrator.processWithdraw({
        customerId: customers[1].id,
        amount: 7,
        address: withdrawAddress,
        idempotencyKey: `withdraw-${runId}`,
        payload: { runId, source: 'private-chain-full-test' },
      });
      console.log('withdraw-result=', JSON.stringify(withdrawResult, null, 2));
    } catch (error) {
      console.log(
        'withdraw-error=',
        error instanceof Error ? error.message : String(error),
      );
    }

    const reconcile = await requestJson(
      `${appUrl}/payments/usdt/reconcile`,
      'POST',
      {},
    );
    console.log('reconcile=', JSON.stringify(reconcile, null, 2));

    const paymentOperations = await prisma.paymentOperation.findMany({
      where: { createdAt: { gte: startedAt } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        operation_type: true,
        status: true,
        idempotency_key: true,
        customer_id: true,
        counterparty_customer_id: true,
        from_address: true,
        to_address: true,
        asset: true,
        amount: true,
        tx_hash: true,
        attempt_count: true,
        payload: true,
        reversal_of_id: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const transactions = await prisma.transaction.findMany({
      where: { createdAt: { gte: startedAt } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        kind: true,
        status: true,
        amount_in: true,
        asset_in: true,
        amount_out: true,
        asset_out: true,
        tx_hash: true,
        sender_customer_id: true,
        receiver_customer_id: true,
        sender_wallet_address: true,
        receiver_wallet_address: true,
        external_address: true,
        comment: true,
        createdAt: true,
      },
    });

    const blockchainTransactions = await prisma.blockchainTransaction.findMany({
      where: { createdAt: { gte: startedAt } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        payment_operation_id: true,
        direction: true,
        network: true,
        asset: true,
        token_contract: true,
        tx_hash: true,
        from_address: true,
        to_address: true,
        amount: true,
        amount_raw: true,
        status: true,
        block_number: true,
        block_timestamp: true,
        confirmations: true,
        gas_payer_address: true,
        fee_amount_raw: true,
        fee_asset: true,
        energy_used: true,
        bandwidth_used: true,
        receipt_status: true,
        createdAt: true,
      },
    });

    const ledgerEntries = await prisma.ledgerEntry.findMany({
      where: { createdAt: { gte: startedAt } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        payment_operation_id: true,
        blockchain_transaction_id: true,
        transaction_id: true,
        customer_id: true,
        asset: true,
        entry_type: true,
        account_type: true,
        amount: true,
        amount_raw: true,
        balance_before: true,
        balance_after: true,
        status: true,
        reference_entry_id: true,
        metadata: true,
        createdAt: true,
      },
    });

    const accountingPostings = await prisma.accountingPosting.findMany({
      where: { createdAt: { gte: startedAt } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        posting_group_key: true,
        sequence: true,
        transaction_id: true,
        payment_operation_id: true,
        debit_account_no: true,
        debit_account_name: true,
        credit_account_no: true,
        credit_account_name: true,
        asset: true,
        amount: true,
        comment: true,
        metadata: true,
        createdAt: true,
      },
    });

    const afterBalances = await prisma.userAssetBalance.findMany({
      where: {
        customer_id: { in: customers.map((c) => c.id) },
        asset: 'USDT_TRC20',
      },
      orderBy: { customer_id: 'asc' },
      select: {
        customer_id: true,
        asset: true,
        balance: true,
        updatedAt: true,
      },
    });

    console.log(
      'paymentOperations=',
      JSON.stringify(paymentOperations, null, 2),
    );
    console.log('transactions=', JSON.stringify(transactions, null, 2));
    console.log(
      'blockchainTransactions=',
      JSON.stringify(blockchainTransactions, null, 2),
    );
    console.log('ledgerEntries=', JSON.stringify(ledgerEntries, null, 2));
    console.log(
      'accountingPostings=',
      JSON.stringify(accountingPostings, null, 2),
    );
    console.log('afterBalances=', JSON.stringify(afterBalances, null, 2));
    console.log('withdrawAddress=', withdrawAddress);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
