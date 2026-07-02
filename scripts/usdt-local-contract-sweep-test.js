const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { genContractAddress } = require('../node_modules/tronweb/lib/commonjs/lib/TransactionBuilder/helper.js');
const TronWebModule = require('tronweb');

if (!globalThis.crypto) {
  globalThis.crypto = crypto.webcrypto;
}

const TEST_CUSTOMERS = [
  { id: 2566667, address: 'TB2vZNBU4CAhpXwfixd5DFMmdVp8V2LpWn' },
  { id: 2566678, address: 'TXF8XYkW9SePRjEnWpNaF4yHevopj7jFUp' },
];

const TOKEN_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'initialHolder', type: 'address' },
      { internalType: 'uint256', name: 'initialSupply', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

const TOKEN_BYTECODE = fs
  .readFileSync(path.join(__dirname, 'usdt-local-contract.bytecode.txt'), 'utf8')
  .trim();

const DEPLOY_FUNDING_SUN = 5_000_000_000;
const DEPLOY_FREEZE_SUN = 2_000_000_000;
const DEPLOY_FEE_LIMIT = 1_000_000_000;

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
  const requestImpl = target.protocol === 'https:' ? https.request : http.request;

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
        timeout: 20000,
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
          resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, raw: data, data: parsed });
        });
      },
    );

    req.on('timeout', () => req.destroy(new Error(`timeout ${url}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTronAddress(value, TronWebCtor) {
  if (typeof value !== 'string') return value;
  if (value.startsWith('T')) return value;
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  const normalizedHex = hex.startsWith('41') ? hex : `41${hex}`;
  return TronWebCtor.address.fromHex(normalizedHex);
}

function resolveDeployedContractAddress(TronWebCtor, deployAddress, unsigned, signed, broadcast) {
  const directAddress =
    unsigned?.contract_address ||
    signed?.contract_address ||
    broadcast?.contract_address ||
    broadcast?.transaction?.contract_address;

  if (directAddress) {
    return normalizeTronAddress(directAddress, TronWebCtor);
  }

  const txHash =
    signed?.txID ||
    unsigned?.txID ||
    broadcast?.txid ||
    broadcast?.transaction?.txID ||
    broadcast?.transaction?.txid;

  if (!txHash) {
    return null;
  }

  const ownerAddress = TronWebCtor.address.toHex(deployAddress);
  return normalizeTronAddress(genContractAddress(ownerAddress, txHash), TronWebCtor);
}

async function getTrxBalanceSun(rpcUrl, address, TronWebCtor) {
  const normalizedAddress = normalizeTronAddress(address, TronWebCtor);
  const hexAddress = TronWebCtor.address.toHex(normalizedAddress);
  const result = await requestJson(`${rpcUrl.replace(/\/+$/, '')}/wallet/getaccount`, 'POST', {
    address: hexAddress,
  });

  if (!result.ok && result.status !== 200) {
    throw new Error(`getaccount failed for ${normalizedAddress}: ${JSON.stringify(result.data || result.raw)}`);
  }

  return Number(result.data?.balance || 0);
}

async function getAccountResource(rpcUrl, address, TronWebCtor) {
  const normalizedAddress = normalizeTronAddress(address, TronWebCtor);
  const hexAddress = TronWebCtor.address.toHex(normalizedAddress);
  const result = await requestJson(`${rpcUrl.replace(/\/+$/, '')}/wallet/getaccountresource`, 'POST', {
    address: hexAddress,
  });

  if (!result.ok && result.status !== 200) {
    throw new Error(`getaccountresource failed for ${normalizedAddress}: ${JSON.stringify(result.data || result.raw)}`);
  }

  return result.data || {};
}

async function waitForResourceUpdate(rpcUrl, address, TronWebCtor, label) {
  for (let i = 0; i < 60; i += 1) {
    const resource = await getAccountResource(rpcUrl, address, TronWebCtor);
    const account = await getTrxBalanceSun(rpcUrl, address, TronWebCtor).catch(() => 0);
    const snapshot = {
      balance_sun: account,
      resource,
    };
    if (i % 5 === 0) {
      console.log(`${label}-resource=`, JSON.stringify(snapshot, null, 2));
    }
    if (i >= 2) {
      return snapshot;
    }
    await sleep(2000);
  }
  return {
    balance_sun: await getTrxBalanceSun(rpcUrl, address, TronWebCtor).catch(() => 0),
    resource: await getAccountResource(rpcUrl, address, TronWebCtor).catch(() => ({})),
  };
}

async function waitForContract(tron, contractAddress, label, probeAddress) {
  for (let i = 0; i < 180; i += 1) {
    try {
      const contract = await tron.trx.getContract(contractAddress);
      if (contract?.contract_address) {
        return contract;
      }
    } catch (error) {
      try {
        if (probeAddress) {
          const contract = await tron.contract(TOKEN_ABI, contractAddress);
          await contract.balanceOf(probeAddress).call();
          return { contract_address: contractAddress };
        }
      } catch (innerError) {
        if (i % 10 === 0) {
          console.log(
            `${label}-poll=`,
            JSON.stringify(
              {
                contractAddress,
                error:
                  innerError instanceof Error
                    ? innerError.message
                    : String(innerError),
              },
              null,
              2,
            ),
          );
        }
      }
    }

    await sleep(2000);
  }

  throw new Error(`${label} contract is not deployed yet: ${contractAddress}`);
}

async function waitForDeployedContractAddress(rpcUrl, txHash, label) {
  for (let i = 0; i < 180; i += 1) {
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

    const txInfo = typeof txInfoRes.data === 'object' && txInfoRes.data ? txInfoRes.data : {};
    const txRaw = typeof txRawRes.data === 'object' && txRawRes.data ? txRawRes.data : {};
    const txInfoContractAddress =
      txInfo.contract_address ||
      txInfo?.transaction?.contract_address ||
      txInfo?.raw_data?.contract?.[0]?.parameter?.value?.new_contract?.contract_address;
    const txRawContractAddress =
      txRaw.contract_address ||
      txRaw?.transaction?.contract_address ||
      txRaw?.raw_data?.contract?.[0]?.parameter?.value?.new_contract?.contract_address;
    const contractAddress = txInfoContractAddress || txRawContractAddress;

    if (contractAddress) {
      return contractAddress;
    }

    if (i % 10 === 0) {
      console.log(
        `${label}-poll=`,
        JSON.stringify(
          {
            txInfo,
            txRaw,
          },
          null,
          2,
        ),
      );
    }

    await sleep(2000);
  }

  throw new Error(`${label} contract address not found for tx: ${txHash}`);
}

function isBandwidthResourceError(error) {
  const code = String(error?.code || error?.error || '').toUpperCase();
  const message = String(error?.message || error?.response?.data?.message || error?.response?.data?.Error || '');
  return (
    code.includes('BANDWIDTH_ERROR') ||
    code.includes('BANDWITH_ERROR') ||
    message.includes('Account resource insufficient error') ||
    message.includes('BANDWITH_ERROR') ||
    message.includes('BANDWIDTH_ERROR')
  );
}

async function freezeAccountBandwidth(tron, privateKey, amountSun, label) {
  const ownerAddress = tron.address.fromPrivateKey(privateKey);
  const ownerHex = tron.address.toHex(ownerAddress);
  const freezeTx = await tron.transactionBuilder.freezeBalanceV2(amountSun, 'BANDWIDTH', ownerHex);
  const signed = await tron.trx.sign(freezeTx, privateKey);
  const broadcast = await tron.trx.sendRawTransaction(signed);
  const txHash = broadcast?.txid || signed?.txID || freezeTx?.txID;
  if (!txHash) {
    throw new Error(`${label} freeze tx hash missing: ${JSON.stringify(broadcast, null, 2)}`);
  }
  await waitTx(process.env.TRON_FULL_NODE || 'http://172.17.0.1:8090', txHash, label);
  await sleep(8000);
  return txHash;
}

async function freezeAccountEnergy(tron, privateKey, amountSun, label) {
  const ownerAddress = tron.address.fromPrivateKey(privateKey);
  const ownerHex = tron.address.toHex(ownerAddress);
  const freezeTx = await tron.transactionBuilder.freezeBalanceV2(amountSun, 'ENERGY', ownerHex);
  const signed = await tron.trx.sign(freezeTx, privateKey);
  const broadcast = await tron.trx.sendRawTransaction(signed);
  const txHash = broadcast?.txid || signed?.txID || freezeTx?.txID;
  if (!txHash) {
    throw new Error(`${label} freeze tx hash missing: ${JSON.stringify(broadcast, null, 2)}`);
  }
  await waitTx(process.env.TRON_FULL_NODE || 'http://172.17.0.1:8090', txHash, label);
  await sleep(8000);
  return txHash;
}

async function waitTx(rpcUrl, txHash, label) {
  for (let i = 0; i < 90; i += 1) {
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

    const txInfo = typeof txInfoRes.data === 'object' && txInfoRes.data ? txInfoRes.data : {};
    const txRaw = typeof txRawRes.data === 'object' && txRawRes.data ? txRawRes.data : {};
    const blockNumber = Number(txInfo.blockNumber || txRaw.blockNumber || 0);
    const receiptResult = txInfo?.receipt?.result || txRaw?.receipt?.result;
    const rawContractResult = Array.isArray(txRaw?.ret)
      ? txRaw.ret.find((item) => item && typeof item === 'object' && item.contractRet)?.contractRet
      : undefined;

    if (receiptResult === 'SUCCESS' || rawContractResult === 'SUCCESS' || blockNumber > 0) {
      return { txInfo, txRaw };
    }

    if (i % 15 === 0) {
      console.log(`${label}-poll=`, JSON.stringify({ txInfo, txRaw }, null, 2));
    }

    await sleep(2000);
  }

  throw new Error(`${label} confirmation timeout: ${txHash}`);
}

async function sendTrx(tron, treasuryPk, toAddress, amountTrx, label) {
  const res = await tron.trx.sendTransaction(toAddress, amountTrx, treasuryPk);
  const txHash = res?.txid || res?.transaction?.txID || res?.transaction?.txid;
  if (!txHash) {
    throw new Error(`${label} trx tx hash missing: ${JSON.stringify(res, null, 2)}`);
  }
  const confirmed = await waitTx(process.env.TRON_FULL_NODE || 'http://172.17.0.1:8090', txHash, label);
  console.log(`${label}=`, JSON.stringify({ send: res, confirmed }, null, 2));
  return txHash;
}

async function sendUsdt(
  tron,
  tokenAbi,
  tokenAddress,
  treasuryPk,
  toAddress,
  amountUsdt,
  label,
) {
  const contract = await tron.contract(tokenAbi, tokenAddress);
  const amountRaw = (BigInt(Math.floor(amountUsdt * 1_000_000)) * 1n).toString();
  const txHash = await contract.transfer(toAddress, amountRaw).send(
    {
      feeLimit: 100_000_000,
      callValue: 0,
      shouldPollResponse: false,
    },
    treasuryPk,
  );

  if (!txHash) {
    throw new Error(`${label} usdt tx hash missing`);
  }

  const confirmed = await waitTx(process.env.TRON_FULL_NODE || 'http://172.17.0.1:8090', txHash, label);
  console.log(`${label}=`, JSON.stringify({ txHash, confirmed }, null, 2));
  return txHash;
}

async function postWebhook(appUrl, webhookSecret, body) {
  const response = await requestJson(
    `${appUrl.replace(/\/+$/, '')}/payments/usdt/deposit-webhook`,
    'POST',
    body,
    { 'x-webhook-secret': webhookSecret },
  );
  console.log(`deposit-webhook-${body.idempotency_key}=`, JSON.stringify(response, null, 2));
  return response;
}

async function main() {
  const mode = process.argv.includes('--deploy-only')
    ? 'deploy-only'
    : 'run';

  const rpcUrl = process.env.TRON_FULL_NODE || process.env.USDT_RPC_URL || 'http://172.17.0.1:8090';
  const appUrl = process.env.APP_URL || 'http://127.0.0.1:8000';
  const witnessPk = process.env.USDT_WITNESS_PRIVATE_KEY || 'da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0';
  const deployPk = process.env.USDT_DEPLOYER_PRIVATE_KEY || witnessPk;
  const treasuryPk = fs.readFileSync('/run/secrets/usdt_treasury_private_key', 'utf8').trim();
  const webhookSecret = fs.readFileSync('/run/secrets/usdt_webhook_secret', 'utf8').trim();
  const TronWebCtor = getTronWebCtor();
  const treasuryTron = new TronWebCtor({ fullHost: rpcUrl, privateKey: treasuryPk });
  const witnessTron = new TronWebCtor({ fullHost: rpcUrl, privateKey: witnessPk });
  const deployTron = new TronWebCtor({ fullHost: rpcUrl, privateKey: deployPk });
  const deployAddress = TronWebCtor.address.fromPrivateKey(deployPk);
  const deploySource = process.env.USDT_DEPLOYER_PRIVATE_KEY ? 'env' : 'witness';
  const treasuryAddress = TronWebCtor.address.fromPrivateKey(treasuryPk);
  const prisma = new PrismaClient();

  try {
    const tokenConfig = process.env.USDT_TOKEN_ADDRESS || process.env.TRON_USDT_CONTRACT || '';

    if (mode === 'deploy-only') {
      const initialSupply = (1_000_000_000n * 1_000_000n).toString();
      const deployerBalanceBefore = await getTrxBalanceSun(rpcUrl, deployAddress, TronWebCtor).catch(() => 0);

      console.log('deploy-only-account=', JSON.stringify({
        deployAddress,
        deployerBalanceBefore,
        deployPkSource: deploySource,
        deployFundingSun: DEPLOY_FUNDING_SUN,
      }, null, 2));

      if (deploySource === 'env') {
        await sendTrx(
          witnessTron,
          witnessPk,
          deployAddress,
          DEPLOY_FUNDING_SUN,
          'deploy-only-fund-deployer',
        );
        await waitForResourceUpdate(rpcUrl, deployAddress, TronWebCtor, 'deploy-only-funded');
        console.log('deploy-only-prep=', JSON.stringify({
          action: 'freezeAccountBandwidth',
          amount_sun: DEPLOY_FREEZE_SUN,
        }, null, 2));
        await freezeAccountBandwidth(deployTron, deployPk, DEPLOY_FREEZE_SUN, 'deploy-only-freeze-bandwidth');
        await waitForResourceUpdate(rpcUrl, deployAddress, TronWebCtor, 'deploy-only-bandwidth');

        console.log('deploy-only-prep=', JSON.stringify({
          action: 'freezeAccountEnergy',
          amount_sun: DEPLOY_FREEZE_SUN,
        }, null, 2));
        await freezeAccountEnergy(deployTron, deployPk, DEPLOY_FREEZE_SUN, 'deploy-only-freeze-energy');
        await waitForResourceUpdate(rpcUrl, deployAddress, TronWebCtor, 'deploy-only-energy');
      } else {
        console.log('deploy-only-prep=', JSON.stringify({
          action: 'deployFromWitness',
          reason: 'default deployer had insufficient TRON resources; witness account has abundant balance and resources on this private chain',
        }, null, 2));
      }

      const createSmartContract = deployTron.transactionBuilder.createSmartContract
        ? deployTron.transactionBuilder.createSmartContract.bind(deployTron.transactionBuilder)
        : null;

      if (!createSmartContract) {
        throw new Error('TronWeb createSmartContract is unavailable');
      }

      const unsigned = await createSmartContract(
        {
          abi: TOKEN_ABI,
          bytecode: TOKEN_BYTECODE,
          feeLimit: DEPLOY_FEE_LIMIT,
          callValue: 0,
          userFeePercentage: 0,
          originEnergyLimit: 0,
          parameters: [treasuryAddress, initialSupply],
          name: 'USDT',
        },
        deployAddress,
      );

      const signed = await deployTron.trx.sign(unsigned, deployPk);
      const broadcast = await deployTron.trx.sendRawTransaction(signed);
      const txHash = broadcast?.txid || signed?.txID || unsigned?.txID;
      if (!txHash) {
        throw new Error(`deploy tx hash missing: ${JSON.stringify(broadcast, null, 2)}`);
      }

      const deployedAddress = resolveDeployedContractAddress(
        TronWebCtor,
        deployAddress,
        unsigned,
        signed,
        broadcast,
      );

      if (!deployedAddress) {
        throw new Error('Token deployment returned no address');
      }

      console.log('deploy-only-contract=', JSON.stringify({
        txHash,
        deployedAddress,
        unsignedContractAddress: unsigned?.contract_address || null,
        signedContractAddress: signed?.contract_address || null,
        broadcastContractAddress: broadcast?.contract_address || broadcast?.transaction?.contract_address || null,
      }, null, 2));

      const deployedAddressFromTx = await waitForDeployedContractAddress(
        rpcUrl,
        txHash,
        'deploy-only-contract',
      );
      const normalizedDeployedAddress = normalizeTronAddress(
        deployedAddressFromTx || deployedAddress,
        TronWebCtor,
      );

      console.log(`USDT_TOKEN_ADDRESS=${normalizedDeployedAddress}`);
      console.log(`TRON_USDT_CONTRACT=${normalizedDeployedAddress}`);
      return;
    }

    if (!tokenConfig || !tokenConfig.startsWith('T')) {
      throw new Error('USDT_TOKEN_ADDRESS is missing. Run with --deploy-only first and put the address into .env.production.');
    }

    const tokenAddress = tokenConfig;
    const runId = String(Date.now());
    await waitForContract(
      treasuryTron,
      tokenAddress,
      'token',
      treasuryAddress,
    );

    const balancesBefore = await Promise.all(
      TEST_CUSTOMERS.map(async (customer) => {
        const row = await prisma.userAssetBalance.findUnique({
          where: {
            customer_id_asset: {
              customer_id: customer.id,
              asset: 'USDT_TRC20',
            },
          },
          select: { customer_id: true, asset: true, balance: true },
        });
        return row || { customer_id: customer.id, asset: 'USDT_TRC20', balance: '0' };
      }),
    );

    console.log('runId=', runId);
    console.log('rpcUrl=', rpcUrl);
    console.log('treasuryAddress=', treasuryAddress);
    console.log('tokenAddress=', tokenAddress);
    console.log('beforeBalances=', JSON.stringify(balancesBefore, null, 2));

    const initialTrxAirdrop = 5_000_000;
    const depositAmount = 1000;

    const tokenAbi = TOKEN_ABI;
    const tokenContract = treasuryTron.contract(tokenAbi, tokenAddress);
    const treasuryTokenBefore = await tokenContract.balanceOf(treasuryAddress).call();
    console.log('treasuryTokenBefore=', treasuryTokenBefore.toString());

    const txHashes = [];

    for (const customer of TEST_CUSTOMERS) {
      await sendTrx(treasuryTron, treasuryPk, customer.address, initialTrxAirdrop, `trx-airdrop-${customer.id}`);
    }

    for (const customer of TEST_CUSTOMERS) {
      const txHash = await sendUsdt(
        treasuryTron,
        tokenAbi,
        tokenAddress,
        treasuryPk,
        customer.address,
        depositAmount,
        `usdt-transfer-${customer.id}`,
      );
      txHashes.push({ customer, txHash });
    }

    for (const item of txHashes) {
      await postWebhook(appUrl, webhookSecret, {
        tx_hash: item.txHash,
        from_address: treasuryAddress,
        to_address: item.customer.address,
        amount: depositAmount,
        idempotency_key: `dep-${runId}-${item.customer.id}`,
        payload: { runId, source: 'local-tron-contract-sweep-test' },
      });
    }

    await sleep(5000);

    const reconcile = await requestJson(
      `${appUrl.replace(/\/+$/, '')}/payments/usdt/reconcile`,
      'POST',
      {},
    );
    console.log('reconcile=', JSON.stringify(reconcile, null, 2));

    await sleep(5000);

    const [paymentOperations, blockchainTransactions, ledgerEntries, transactions, balancesAfter, onChainBalances] = await Promise.all([
      prisma.paymentOperation.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
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
          last_error: true,
          payload: true,
          reversal_of_id: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.blockchainTransaction.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
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
      }),
      prisma.ledgerEntry.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
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
      }),
      prisma.transaction.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
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
      }),
      prisma.userAssetBalance.findMany({
        where: {
          customer_id: { in: TEST_CUSTOMERS.map((customer) => customer.id) },
          asset: 'USDT_TRC20',
        },
        orderBy: { customer_id: 'asc' },
        select: {
          customer_id: true,
          asset: true,
          balance: true,
          updatedAt: true,
        },
      }),
      Promise.all(
        TEST_CUSTOMERS.map(async (customer) => ({
          customer_id: customer.id,
          address: customer.address,
          trx: await getTrxBalanceSun(rpcUrl, customer.address, TronWebCtor),
          usdt: String(await tokenContract.balanceOf(customer.address).call()),
        })),
      ),
    ]);

    const treasuryTokenAfter = await tokenContract.balanceOf(treasuryAddress).call();

    console.log('paymentOperations=', JSON.stringify(paymentOperations, null, 2));
    console.log('blockchainTransactions=', JSON.stringify(blockchainTransactions, null, 2));
    console.log('ledgerEntries=', JSON.stringify(ledgerEntries, null, 2));
    console.log('transactions=', JSON.stringify(transactions, null, 2));
    console.log('balancesAfter=', JSON.stringify(balancesAfter, null, 2));
    console.log('onChainBalances=', JSON.stringify(onChainBalances, null, 2));
    console.log('treasuryTokenAfter=', treasuryTokenAfter.toString());
    console.log('result=', JSON.stringify({ ok: true }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
