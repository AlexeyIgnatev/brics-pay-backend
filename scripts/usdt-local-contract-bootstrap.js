const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const TronWebModule = require('tronweb');

function runNode(args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function extractTokenAddress(output) {
  const patterns = [
    /^USDT_TOKEN_ADDRESS=(T[1-9A-HJ-NP-Za-km-z]{20,})$/m,
    /^TRON_USDT_CONTRACT=(T[1-9A-HJ-NP-Za-km-z]{20,})$/m,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
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

async function requestJson(url, method, body) {
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
        },
        timeout: 15000,
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

async function verifyContract(rpcUrl, tokenAddress) {
  const TronWebCtor = getTronWebCtor();
  const tokenAddressHex = TronWebCtor.address.toHex(tokenAddress);
  for (let i = 0; i < 30; i += 1) {
    const response = await requestJson(
      `${rpcUrl.replace(/\/+$/, '')}/wallet/getcontract`,
      'POST',
      { value: tokenAddressHex },
    );

    const contract = response.data && typeof response.data === 'object' ? response.data : null;
    if (contract && Object.keys(contract).length > 0) {
      console.log('bootstrap-contract=', JSON.stringify(contract, null, 2));
      return contract;
    }

    if (i % 5 === 0) {
      console.log(
        'bootstrap-contract-poll=',
        JSON.stringify(
          {
            tokenAddress,
            tokenAddressHex,
            status: response.status,
            raw: response.raw,
          },
          null,
          2,
        ),
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`token contract is not deployed yet: ${tokenAddress}`);
}

function upsertEnvLine(source, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(source)) {
    return source.replace(pattern, line);
  }

  return source.endsWith('\n') ? `${source}${line}\n` : `${source}\n${line}\n`;
}

async function updateEnvFile(envFile, tokenAddress) {
  if (!envFile || !fs.existsSync(envFile)) {
    console.log(
      'bootstrap-env-warning=',
      JSON.stringify(
        {
          message: 'Env file not found, skipping persistence of USDT_TOKEN_ADDRESS/TRON_USDT_CONTRACT',
          envFile: envFile || null,
        },
        null,
        2,
      ),
    );
    return false;
  }

  const current = fs.readFileSync(envFile, 'utf8');
  let next = upsertEnvLine(current, 'USDT_TOKEN_ADDRESS', tokenAddress);
  next = upsertEnvLine(next, 'TRON_USDT_CONTRACT', tokenAddress);
  fs.writeFileSync(envFile, next, 'utf8');
  console.log('bootstrap-env-updated=', JSON.stringify({ envFile, tokenAddress }, null, 2));
  return true;
}

async function main() {
  const repoRoot = process.cwd();
  const envFileCandidates = [
    process.env.BRICS_ENV_FILE,
    path.join(repoRoot, '.env.production'),
    '/app/.env.production',
  ].filter(Boolean);
  const envFile = envFileCandidates.find((candidate) => fs.existsSync(candidate)) || null;
  const rpcUrl = process.env.TRON_FULL_NODE || process.env.USDT_RPC_URL || 'http://172.17.0.1:8090';

  console.log('bootstrap-step=', JSON.stringify({ step: 'deploy-only' }, null, 2));
  const deployRun = await runNode(
    ['scripts/usdt-local-contract-sweep-test.js', '--deploy-only'],
    repoRoot,
    { ...process.env },
  );

  if (deployRun.code !== 0) {
    throw new Error(`deploy-only failed with exit code ${deployRun.code}`);
  }

  const tokenAddress = extractTokenAddress(`${deployRun.stdout}\n${deployRun.stderr}`);
  if (!tokenAddress) {
    throw new Error('USDT_TOKEN_ADDRESS not found in deploy-only output');
  }

  console.log('bootstrap-token-address=', JSON.stringify({ tokenAddress }, null, 2));
  await updateEnvFile(envFile, tokenAddress);
  process.env.USDT_TOKEN_ADDRESS = tokenAddress;
  process.env.TRON_USDT_CONTRACT = tokenAddress;

  console.log('bootstrap-step=', JSON.stringify({ step: 'verify-contract', rpcUrl }, null, 2));
  try {
    await verifyContract(rpcUrl, tokenAddress);
  } catch (error) {
    console.log(
      'bootstrap-contract-warning=',
      JSON.stringify(
        {
          tokenAddress,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
  }

  console.log('bootstrap-step=', JSON.stringify({ step: 'full-test' }, null, 2));
  const fullRun = await runNode(
    ['scripts/usdt-local-contract-sweep-test.js'],
    repoRoot,
    { ...process.env },
  );

  if (fullRun.code !== 0) {
    throw new Error(`full test failed with exit code ${fullRun.code}`);
  }

  console.log('bootstrap-result=', JSON.stringify({ ok: true, tokenAddress }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
