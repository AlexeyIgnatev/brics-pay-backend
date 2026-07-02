const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const solc = require('solc');
const { PrismaClient } = require('@prisma/client');
const TronWebModule = require('tronweb');

if (!globalThis.crypto) {
  globalThis.crypto = crypto.webcrypto;
}

const TEST_CUSTOMERS = [
  { id: 2566667, address: 'TB2vZNBU4CAhpXwfixd5DFMmdVp8V2LpWn' },
  { id: 2566678, address: 'TXF8XYkW9SePRjEnWpNaF4yHevopj7jFUp' },
];

const TOKEN_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TestUSDT {
    string public name = "Local Test USDT";
    string public symbol = "USDT";
    uint8 public decimals = 6;
    uint256 public totalSupply;
    address public owner;
    mapping(address => uint256) private balances;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor(address initialHolder, uint256 initialSupply) {
        owner = msg.sender;
        _mint(initialHolder, initialSupply);
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function mint(address to, uint256 amount) external onlyOwner returns (bool) {
        _mint(to, amount);
        return true;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "zero address");
        uint256 fromBalance = balances[from];
        require(fromBalance >= amount, "insufficient balance");
        unchecked {
            balances[from] = fromBalance - amount;
        }
        balances[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "zero address");
        balances[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }
}`;

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

function compileToken() {
  const input = {
    language: 'Solidity',
    sources: {
      'TestUSDT.sol': { content: TOKEN_SOURCE },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object'],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (Array.isArray(output.errors)) {
    const fatal = output.errors.filter((item) => item.severity === 'error');
    if (fatal.length > 0) {
      throw new Error(fatal.map((item) => item.formattedMessage).join('\n'));
    }
  }

  const artifact = output.contracts?.['TestUSDT.sol']?.TestUSDT;
  if (!artifact?.abi?.length || !artifact?.evm?.bytecode?.object) {
    throw new Error('Failed to compile local token contract');
  }

  return {
    abi: artifact.abi,
    bytecode: artifact.evm.bytecode.object,
  };
}

function normalizeTronAddress(value, TronWebCtor) {
  if (typeof value !== 'string') return value;
  if (value.startsWith('T')) return value;
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  const normalizedHex = hex.startsWith('41') ? hex : `41${hex}`;
  return TronWebCtor.address.fromHex(normalizedHex);
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

    if (receiptResult === 'SUCCESS' || blockNumber > 0 || txInfo.id === txHash || txRaw.txID === txHash) {
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
  const treasuryPk = fs.readFileSync('/run/secrets/usdt_treasury_private_key', 'utf8').trim();
  const webhookSecret = fs.readFileSync('/run/secrets/usdt_webhook_secret', 'utf8').trim();
  const TronWebCtor = getTronWebCtor();
  const tron = new TronWebCtor({ fullHost: rpcUrl, privateKey: treasuryPk });
  const treasuryAddress = TronWebCtor.address.fromPrivateKey(treasuryPk);
  const prisma = new PrismaClient();
  const compiledToken = compileToken();

  try {
    const tokenConfig = process.env.USDT_TOKEN_ADDRESS || process.env.TRON_USDT_CONTRACT || '';

    if (mode === 'deploy-only') {
      const initialSupply = (1_000_000_000n * 1_000_000n).toString();
      const contract = await tron.contract(compiledToken.abi).new(
        {
          abi: compiledToken.abi,
          bytecode: compiledToken.bytecode,
          feeLimit: 100_000_000,
          callValue: 0,
          userFeePercentage: 0,
          originEnergyLimit: 0,
          parameters: [treasuryAddress, initialSupply],
        },
        treasuryPk,
      );

      const deployedAddress = normalizeTronAddress(
        contract?.address || contract?.options?.address,
        TronWebCtor,
      );

      if (!deployedAddress) {
        throw new Error('Token deployment returned no address');
      }

      console.log(`USDT_TOKEN_ADDRESS=${deployedAddress}`);
      console.log(`TRON_USDT_CONTRACT=${deployedAddress}`);
      return;
    }

    if (!tokenConfig || !tokenConfig.startsWith('T')) {
      throw new Error('USDT_TOKEN_ADDRESS is missing. Run with --deploy-only first and put the address into .env.production.');
    }

    const tokenAddress = tokenConfig;
    const runId = String(Date.now());

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

    const initialTrxAirdrop = 5;
    const depositAmount = 1000;

    const tokenAbi = compiledToken.abi;
    const tokenContract = await tron.contract(tokenAbi, tokenAddress);
    const treasuryTokenBefore = await tokenContract.balanceOf(treasuryAddress).call();
    console.log('treasuryTokenBefore=', treasuryTokenBefore.toString());

    const txHashes = [];

    for (const customer of TEST_CUSTOMERS) {
      await sendTrx(tron, treasuryPk, customer.address, initialTrxAirdrop, `trx-airdrop-${customer.id}`);
    }

    for (const customer of TEST_CUSTOMERS) {
      const txHash = await sendUsdt(
        tron,
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
          trx: await tron.trx.getBalance(customer.address),
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
