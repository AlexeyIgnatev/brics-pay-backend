const crypto = require('crypto');
const TronWebModule = require('tronweb');

const TronWeb = TronWebModule.TronWeb || TronWebModule.default || TronWebModule;

const RPC = process.env.TRON_RPC_URL || 'http://172.17.0.1:8090';
const WITNESS_PK = process.env.TRON_WITNESS_PRIVATE_KEY || 'da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0';
const FUND_TRX = Number(process.env.TRON_TEST_FUND_TRX || '50');

function makeWallet() {
  const pk = crypto.randomBytes(32).toString('hex');
  const address = TronWeb.address.fromPrivateKey(pk);
  return { pk, address };
}

async function waitTx(txid) {
  for (let i = 0; i < 40; i += 1) {
    const res = await fetch(`${RPC.replace(/\/+$/, '')}/wallet/gettransactioninfobyid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: txid }),
    });
    const data = await res.json().catch(() => ({}));
    if (data && Number(data.blockNumber || 0) > 0) return data;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
}

async function main() {
  const witness = new TronWeb({
    fullHost: RPC,
    privateKey: WITNESS_PK,
  });

  const browserWallet = makeWallet();
  const commonWallet = makeWallet();

  console.log('browser_wallet=', JSON.stringify(browserWallet, null, 2));
  console.log('common_wallet=', JSON.stringify(commonWallet, null, 2));

  const amountSun = Math.round(FUND_TRX * 1_000_000);
  const fund1 = await witness.trx.sendTransaction(browserWallet.address, amountSun, WITNESS_PK);
  const fund2 = await witness.trx.sendTransaction(commonWallet.address, amountSun, WITNESS_PK);

  const tx1 = fund1?.txid || fund1?.transaction?.txID;
  const tx2 = fund2?.txid || fund2?.transaction?.txID;

  console.log('browser_fund_tx=', tx1);
  console.log('common_fund_tx=', tx2);

  const confirmed1 = tx1 ? await waitTx(tx1) : null;
  const confirmed2 = tx2 ? await waitTx(tx2) : null;

  console.log('browser_confirmed=', JSON.stringify(confirmed1, null, 2));
  console.log('common_confirmed=', JSON.stringify(confirmed2, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
