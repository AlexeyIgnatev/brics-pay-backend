#!/usr/bin/env node
const http = require('http');
const https = require('https');
const { URL } = require('url');

function parseArgs(argv) {
  const args = {
    backendUrl: process.env.BACKEND_URL || 'http://127.0.0.1:8000',
    bricsRoot: process.env.BRICS_API_ROOT,
    integrationRoot: process.env.INTEGRATION_API_ROOT,
    integrationRoots: process.env.INTEGRATION_API_ROOTS,
    backendAdminEmail: process.env.BACKEND_ADMIN_EMAIL || process.env.ADMIN_EMAIL,
    backendAdminPassword: process.env.BACKEND_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD,
    bricsAdminLogin: process.env.BRICS_ADMIN_LOGIN || process.env.ADMIN_LOGIN,
    bricsAdminPassword: process.env.BRICS_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD,
    limit: Number(process.env.PAIR_SCAN_LIMIT || 1000),
    probePage: true,
  };

  for (const item of argv) {
    if (item === '--no-probe-page') {
      args.probePage = false;
      continue;
    }
    if (item === '--probe-page') {
      args.probePage = true;
      continue;
    }

    const [key, rawValue] = item.split('=');
    if (!rawValue) continue;
    if (key === '--backend-url') args.backendUrl = rawValue;
    if (key === '--brics-root') args.bricsRoot = rawValue;
    if (key === '--integration-root') args.integrationRoot = rawValue;
    if (key === '--integration-roots') args.integrationRoots = rawValue;
    if (key === '--backend-admin-email') args.backendAdminEmail = rawValue;
    if (key === '--backend-admin-password') args.backendAdminPassword = rawValue;
    if (key === '--brics-admin-login') args.bricsAdminLogin = rawValue;
    if (key === '--brics-admin-password') args.bricsAdminPassword = rawValue;
    if (key === '--limit') args.limit = Number(rawValue);
  }

  return args;
}

function requireValue(name, value) {
  if (!value) {
    throw new Error(`Missing required value: ${name}`);
  }
  return value;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function normalizeKey(key) {
  return String(key || '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function shortenText(value, max = 220) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text || 'empty';
  return `${text.slice(0, max)}…`;
}

function extractRecords(payload) {
  const collected = [];
  const visited = new Set();

  const visit = (value) => {
    if (value == null || collected.length > 500) return;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          visit(JSON.parse(trimmed));
        } catch {
          return;
        }
      }
      return;
    }

    if (typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const keys = Object.keys(value).map(normalizeKey);
    if (keys.includes(normalizeKey('CurrencyID')) || keys.includes(normalizeKey('AccountNo'))) {
      collected.push(value);
    }

    Object.values(value).forEach(visit);
  };

  visit(payload);
  return collected;
}

function uniqAccounts(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = `${item.AccountNo}|${item.CurrencyID}|${item.CustomerID}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function signatureForAccount(account) {
  const omit = new Set(
    ['AccountNo', 'CustomerID', 'Name', 'Name2', 'QrCode', 'QrCodeBase64'].map(normalizeKey),
  );

  const entries = Object.entries(account)
    .filter(([key, value]) => !omit.has(normalizeKey(key)) && value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, value === null ? '__null__' : value]);

  return JSON.stringify(entries);
}

function buildPhoneCandidates(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return [];
  const digits = raw.replace(/\D/g, '');
  const out = new Set([raw, raw.replace(/\s+/g, '')]);
  if (digits) {
    out.add(digits);
    out.add(`+${digits}`);
    if (digits.startsWith('996') && digits.length > 3) {
      out.add(`0${digits.slice(3)}`);
    }
  }
  return [...out].filter(Boolean);
}

function buildBricsUrl(bricsRoot, path) {
  const root = String(bricsRoot || '').replace(/\/+$/, '');
  const base = root.toLowerCase().endsWith('/internetbanking') ? root : `${root}/InternetBanking`;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function buildIntegrationUrl(integrationRoot, path) {
  const root = String(integrationRoot || '').replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (/\/OnlineBank\.IntegrationService$/i.test(root)) {
    return `${root}${normalizedPath}`;
  }
  return `${root}/OnlineBank.IntegrationService${normalizedPath}`;
}

function deriveIntegrationRoot(bricsRoot) {
  const root = String(bricsRoot || '').replace(/\/+$/, '');
  return root.replace(/\/InternetBanking$/i, '');
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function parseIntegrationRoots(argsIntegrationRoot, argsIntegrationRoots, bricsRoot) {
  const roots = [];
  if (argsIntegrationRoots) {
    roots.push(
      ...String(argsIntegrationRoots)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
  }
  if (argsIntegrationRoot) {
    roots.push(argsIntegrationRoot);
  }
  const derived = deriveIntegrationRoot(bricsRoot);
  if (derived) roots.push(derived);
  return uniqueStrings(roots);
}

function cookiesFromHeader(setCookieHeader) {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
  return header
    .map((cookie) => String(cookie).split(';')[0])
    .filter(Boolean);
}

function mergeCookies(cookieList) {
  return [...new Set(cookieList.filter(Boolean))].join('; ');
}

function requestRaw(urlString, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    timeout = 30000,
    rejectUnauthorized = false,
  } = options;

  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === 'https:' ? https : http;
    const payload =
      body == null
        ? null
        : Buffer.isBuffer(body)
          ? body
          : typeof body === 'string'
            ? Buffer.from(body)
            : Buffer.from(JSON.stringify(body));

    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          ...headers,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        rejectUnauthorized,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            text,
          });
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error(`Request timeout after ${timeout}ms`)));
    if (payload) req.write(payload);
    req.end();
  });
}

async function requestText(url, options = {}) {
  const response = await requestRaw(url, options);
  return response;
}

async function requestJson(url, options = {}) {
  const response = await requestRaw(url, options);
  let data = null;
  if (response.text) {
    try {
      data = JSON.parse(response.text);
    } catch {
      data = response.text;
    }
  }
  return { ...response, data };
}

function describeJsonShape(payload) {
  if (payload == null) {
    return { type: 'null', topKeys: [], resultType: 'null', resultKeys: [], preview: 'empty' };
  }

  const responseType = Array.isArray(payload) ? 'array' : typeof payload;
  const topKeys =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? Object.keys(payload).slice(0, 20)
      : [];
  const rawResult =
    payload && typeof payload === 'object' && !Array.isArray(payload) && 'Result' in payload
      ? payload.Result
      : payload;
  const resultType = Array.isArray(rawResult) ? 'array' : typeof rawResult;
  const resultKeys =
    rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
      ? Object.keys(rawResult).slice(0, 20)
      : [];
  const preview =
    typeof rawResult === 'string'
      ? shortenText(rawResult, 500)
      : rawResult && typeof rawResult === 'object'
        ? shortenText(JSON.stringify(rawResult), 500)
        : shortenText(rawResult, 500);

  return { responseType, topKeys, resultType, resultKeys, preview, rawResult };
}

async function loginBackend(backendUrl, adminLogin, adminPassword) {
  const response = await requestJson(`${backendUrl}/admin-management/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminLogin, password: adminPassword }),
  });

  const token = response.data && response.data.accessToken;
  if (!token) {
    throw new Error(`Backend login failed for ${adminLogin}: ${String(response.text || '').slice(0, 300)}`);
  }
  return token;
}

async function loadAllUsers(backendUrl, token, limit) {
  const items = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const response = await requestJson(`${backendUrl}/user-management?offset=${offset}&limit=${limit}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = response.data || {};
    const pageItems = Array.isArray(data.items) ? data.items : [];
    items.push(...pageItems);
    total = Number.isFinite(Number(data.total)) ? Number(data.total) : items.length;
    if (pageItems.length < limit) break;
    offset += limit;
  }

  return items;
}

async function loginBrics(bricsRoot, adminLogin, adminPassword) {
  const loginPage = await requestText(`${bricsRoot}/InternetBanking/Account/Login`, {
    method: 'GET',
    timeout: 30000,
    rejectUnauthorized: false,
  });

  const loginHtml = String(loginPage.text || '');
  const token =
    loginHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i)?.[1] ||
    loginHtml.match(/name="__RequestVerificationToken"[\s\S]*?value="([^"]+)"/i)?.[1];

  if (!token) {
    throw new Error(`BRICS token not found on login page. Snippet=${loginHtml.slice(0, 300).replace(/\s+/g, ' ')}`);
  }

  const pageCookies = cookiesFromHeader(loginPage.headers['set-cookie']);
  const body = new URLSearchParams();
  body.append('__RequestVerificationToken', token);
  body.append('UserName', adminLogin);
  body.append('Password', adminPassword);

  const response = await requestText(`${bricsRoot}/InternetBanking/Account/Login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      Referer: `${bricsRoot}/InternetBanking/Account/Login?ReturnUrl=%2FInternetBanking`,
      Origin: bricsRoot,
      Cookie: mergeCookies(pageCookies),
    },
    body,
    timeout: 30000,
    rejectUnauthorized: false,
  });

  const postCookies = cookiesFromHeader(response.headers['set-cookie']);
  const cookies = mergeCookies([...pageCookies, ...postCookies]);

  if (!cookies) {
    throw new Error('BRICS cookies were not returned after login');
  }

  return cookies;
}

async function fetchSomAccountsByCustomerId(integrationRoot, cookies, customerId) {
  const url = buildIntegrationUrl(
    integrationRoot,
    `/api/Deposits/GetCurrentAccounts?customerID=${encodeURIComponent(customerId)}`,
  );
  const response = await requestJson(
    url,
    {
      method: 'GET',
      headers: {
        Cookie: cookies,
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
      rejectUnauthorized: false,
    },
  );

  const shape = describeJsonShape(response.data);
  const records = extractRecords(shape.rawResult);
  console.log(
    [
      `[som-lookup][customer] url=${url}`,
      `[som-lookup][customer] customer=${customerId}`,
      `status=${response.status}`,
      `responseType=${shape.responseType}`,
      `topKeys=${shape.topKeys.join(',') || 'none'}`,
      `resultType=${shape.resultType}`,
      `resultKeys=${shape.resultKeys.join(',') || 'none'}`,
      `records=${records.length}`,
      `preview=${shape.preview}`,
    ].join(' | '),
  );

  return uniqAccounts(
    records
      .map((item) => ({
        ...item,
        AccountNo: String(
          item.AccountNo ??
            item.accountNo ??
            item.AccountNumber ??
            item.account_number ??
            item.Iban ??
            item.IBAN ??
            '',
        ),
        CurrencyID: Number(
          item.CurrencyID ?? item.currencyId ?? item.currency_id ?? item.currencyID ?? item.CurrencyId,
        ),
        CustomerID: Number(
          item.CustomerID ?? item.customerId ?? item.customer_id ?? item.customerID ?? item.CustomerId,
        ),
      }))
      .filter((item) => Number(item.CurrencyID) === 417 && item.AccountNo),
  );
}

async function fetchSomAccountsByPhone(integrationRoot, cookies, phone) {
  const candidates = buildPhoneCandidates(phone);
  for (const candidate of candidates) {
    const url = buildBricsUrl(
      integrationRoot,
      '/ru-RU/Reference/GetAccountsByAccountNoOrPhone',
    );
    const response = await requestJson(
      url,
      {
        method: 'POST',
        headers: {
          Cookie: cookies,
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ account: candidate }),
        rejectUnauthorized: false,
      },
    );

    const shape = describeJsonShape(response.data);
    const rawRecords = extractRecords(shape.rawResult);
    const accounts = uniqAccounts(
      rawRecords
        .map((item) => ({
          ...item,
          AccountNo: String(
            item.AccountNo ??
              item.accountNo ??
              item.AccountNumber ??
              item.account_number ??
              item.Iban ??
              item.IBAN ??
              '',
          ),
          CurrencyID: Number(
            item.CurrencyID ?? item.currencyId ?? item.currency_id ?? item.currencyID ?? item.CurrencyId,
          ),
          CustomerID: Number(
            item.CustomerID ?? item.customerId ?? item.customer_id ?? item.customerID ?? item.CustomerId,
          ),
        }))
        .filter((item) => Number(item.CurrencyID) === 417 && item.AccountNo),
    );

    console.log(
      [
        `[som-lookup][phone] url=${url}`,
        `[som-lookup][phone] phone=${phone}`,
        `candidate=${candidate}`,
        `status=${response.status}`,
        `responseType=${shape.responseType}`,
        `topKeys=${shape.topKeys.join(',') || 'none'}`,
        `resultType=${shape.resultType}`,
        `resultKeys=${shape.resultKeys.join(',') || 'none'}`,
        `records=${rawRecords.length}`,
        `somAccounts=${accounts.length}`,
        `preview=${shape.preview}`,
      ].join(' | '),
    );

    if (accounts.length > 0) return accounts;
  }

  return [];
}

async function probeInternalTransactionPage(bricsRoot, cookies, accountNo) {
  const response = await requestText(
    `${bricsRoot}/InternetBanking/ru-RU/Accounts/InternalTransaction?Mode=Create&OperationType=InternalOperation&AccountNo=${encodeURIComponent(accountNo)}&CurrencyID=417`,
    {
      method: 'GET',
      headers: {
        Cookie: cookies,
        Accept: 'text/html',
      },
      rejectUnauthorized: false,
    },
  );

  const body = String(response.text || '');
  return {
    status: response.status,
    ok: body.includes('vmInternalTransaction') || body.includes('template-page'),
    hasError: /alert_type_error|alert__body|error/i.test(body),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const backendUrl = args.backendUrl.replace(/\/+$/, '');
  const bricsRoot = requireValue('BRICS_API_ROOT', args.bricsRoot).replace(/\/+$/, '');
  const integrationRoots = parseIntegrationRoots(
    args.integrationRoot,
    args.integrationRoots,
    bricsRoot,
  ).map((root) => root.replace(/\/+$/, ''));
  const backendAdminEmail =
    args.backendAdminEmail && isEmail(args.backendAdminEmail)
      ? args.backendAdminEmail
      : 'admin@admin.admin';
  const backendAdminPassword = requireValue('BACKEND_ADMIN_PASSWORD or ADMIN_PASSWORD', args.backendAdminPassword);
  const bricsAdminLogin = requireValue('BRICS_ADMIN_LOGIN or ADMIN_LOGIN', args.bricsAdminLogin);
  const bricsAdminPassword = requireValue('BRICS_ADMIN_PASSWORD or ADMIN_PASSWORD', args.bricsAdminPassword);

  console.log(`[1/4] login backend as ${backendAdminEmail}`);
  const backendToken = await loginBackend(backendUrl, backendAdminEmail, backendAdminPassword);

  console.log('[2/4] load users');
  const users = await loadAllUsers(backendUrl, backendToken, args.limit);
  const phoneUsers = users.filter((user) => String(user.phone || '').trim().length > 0);
  console.log(`users=${users.length} phoneUsers=${phoneUsers.length}`);

  console.log('[3/4] login brics');
  const cookies = await loginBrics(bricsRoot, bricsAdminLogin, bricsAdminPassword);

  console.log('[4/4] scan SOM accounts');
  console.log(
    `[som-scan] roots bricsRoot=${bricsRoot} integrationRoots=${integrationRoots.join(',') || 'none'} backendUrl=${backendUrl}`,
  );
  const accounts = [];
  for (const user of phoneUsers) {
    console.log(
      `[som-scan] start customer=${user.customer_id} fio="${[user.last_name, user.first_name, user.middle_name].filter(Boolean).join(' ')}" phone=${user.phone}`,
    );
    let somAccounts = [];
    let matchedIntegrationRoot = '';
    const integrationAttempts = [];
    for (const integrationRoot of integrationRoots) {
      somAccounts = await fetchSomAccountsByCustomerId(integrationRoot, cookies, user.customer_id);
      integrationAttempts.push(`${integrationRoot}:${somAccounts.length}`);
      if (somAccounts.length > 0) {
        matchedIntegrationRoot = integrationRoot;
        break;
      }
    }
    if (somAccounts.length === 0) {
      somAccounts = await fetchSomAccountsByPhone(bricsRoot, cookies, user.phone);
    }
    if (matchedIntegrationRoot) {
      console.log(
        `[som-scan] customer=${user.customer_id} matchedIntegrationRoot=${matchedIntegrationRoot} attempts=${integrationAttempts.join(',') || 'none'}`,
      );
    } else {
      console.log(
        `[som-scan] customer=${user.customer_id} no integration match attempts=${integrationAttempts.join(',') || 'none'} phoneFallback=${somAccounts.length > 0 ? 'hit' : 'miss'}`,
      );
    }
    console.log(
      `[som-scan] done customer=${user.customer_id} phone=${user.phone} somAccounts=${somAccounts.length} integrationRoot=${matchedIntegrationRoot || 'none'}`,
    );
    for (const account of somAccounts) {
      accounts.push({
        customer_id: user.customer_id,
        fio: [user.last_name, user.first_name, user.middle_name].filter(Boolean).join(' '),
        phone: user.phone,
        ...account,
      });
    }
  }

  const uniqueAccounts = uniqAccounts(accounts);
  console.log(`som_accounts=${uniqueAccounts.length}`);

  const groups = new Map();
  for (const account of uniqueAccounts) {
    const sig = signatureForAccount(account);
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(account);
  }

  const multiGroups = [...groups.values()].filter((group) => group.length > 1);
  console.log(`candidate_groups=${multiGroups.length}`);

  for (const [idx, group] of multiGroups.entries()) {
    console.log(`\n=== GROUP ${idx + 1} size=${group.length} ===`);
    console.log(`signature=${signatureForAccount(group[0])}`);
    for (const account of group) {
      const probe = args.probePage
        ? await probeInternalTransactionPage(bricsRoot, cookies, account.AccountNo)
        : null;
      console.log(
        [
          `customer=${account.customer_id}`,
          `fio="${account.fio}"`,
          `phone=${account.phone}`,
          `account=${account.AccountNo}`,
          `currency=${account.CurrencyID}`,
          `pageOk=${probe ? probe.ok : 'skipped'}`,
          `pageStatus=${probe ? probe.status : 'skipped'}`,
        ].join(' | '),
      );
    }

    const pairCount = (group.length * (group.length - 1)) / 2;
    console.log(`pairs_in_group=${pairCount}`);
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i];
        const b = group[j];
        console.log(`PAIR: ${a.AccountNo} (${a.customer_id}) <-> ${b.AccountNo} (${b.customer_id})`);
      }
    }
  }

  if (multiGroups.length === 0) {
    console.log('No same-signature SOM groups found.');
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
