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
          } catch {
            // keep raw string if response isn't JSON
          }
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
  for (let i = 0; i < 60; i += 1) {
    const res = await requestJson(
      `${rpcUrl.replace(/\/+$/, '')}/wallet/gettransactioninfobyid`,
      'POST',
      { value: txHash },
    );
    const info = typeof res.data === 'object' && res.data ? res.data : {};
    if (Number(info.blockNumber || 0) > 0) {
      console.log(`${label}-confirmed=`, JSON.stringify(info, null, 2));
      return info;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`${label} confirmation timeout: ${txHash}`);
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
    const webhookSecret = fs
      .readFileSync('/run/secrets/usdt_webhook_secret', 'utf8')
      .trim();
    const treasuryPk = fs
      .readFileSync('/run/secrets/usdt_treasury_private_key', 'utf8')
      .trim();

    const TronWebCtor = getTronWebCtor();
    const tron = new TronWebCtor({ fullHost: rpcUrl, privateKey: treasuryPk });
    const treasuryAddress = TronWebCtor.address.fromPrivateKey(treasuryPk);

    const customers = [
      { id: 2566667, address: 'TB2vZNBU4CAhpXwfixd5DFMmdVp8V2LpWn' },
      { id: 2566678, address: 'TXF8XYkW9SePRjEnWpNaF4yHevopj7jFUp' },
    ];

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

    const dep1 = await tron.trx.sendTransaction(
      customers[0].address,
      1,
      treasuryPk,
    );
    const dep2 = await tron.trx.sendTransaction(
      customers[1].address,
      1,
      treasuryPk,
    );

    const tx1 = dep1.txid || dep1.transaction?.txID || dep1.transaction?.txid;
    const tx2 = dep2.txid || dep2.transaction?.txID || dep2.transaction?.txid;

    if (!tx1 || !tx2) {
      throw new Error(
        `deposit tx missing: ${JSON.stringify({ dep1, dep2 }, null, 2)}`,
      );
    }

    console.log('deposit-1-send=', JSON.stringify(dep1, null, 2));
    console.log('deposit-2-send=', JSON.stringify(dep2, null, 2));

    await waitTx(rpcUrl, tx1, 'deposit-1');
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
