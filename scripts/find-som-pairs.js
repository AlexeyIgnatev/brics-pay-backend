#!/usr/bin/env node
const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

function parseArgs(argv) {
  const args = {
    backendUrl: process.env.BACKEND_URL || 'http://127.0.0.1:8000',
    bricsRoot: process.env.BRICS_API_ROOT,
    adminLogin: process.env.ADMIN_LOGIN,
    adminPassword: process.env.ADMIN_PASSWORD,
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
    if (key === '--admin-login') args.adminLogin = rawValue;
    if (key === '--admin-password') args.adminPassword = rawValue;
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

function normalizeKey(key) {
  return String(key || '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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

    const record = value;
    const keys = Object.keys(record).map(normalizeKey);
    if (keys.includes(normalizeKey('CurrencyID')) || keys.includes(normalizeKey('AccountNo'))) {
      collected.push(record);
    }

    Object.values(record).forEach(visit);
  };

  visit(payload);
  return collected;
}

function signatureForAccount(account) {
  const omit = new Set([
    'AccountNo',
    'CustomerID',
    'Name',
    'Name2',
    'QrCode',
    'QrCodeBase64',
  ].map(normalizeKey));

  const entries = Object.entries(account)
    .filter(([key, value]) => !omit.has(normalizeKey(key)) && value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, value === null ? '__null__' : value]);

  return JSON.stringify(entries);
}

function accountLabel(account) {
  const name = account.Name || account.accountName || account.AccountName || 'unknown';
  const customerId = account.CustomerID ?? account.customer_id ?? 'n/a';
  const accountNo = account.AccountNo ?? account.accountNo ?? 'n/a';
  return `${customerId} | ${accountNo} | ${name}`;
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

async function loginBackend(http, backendUrl, adminLogin, adminPassword) {
  const response = await http.post(`${backendUrl}/admin-management/auth/login`, {
    email: adminLogin,
    password: adminPassword,
  });
  return response.data.accessToken;
}

async function loadAllUsers(http, backendUrl, token, limit) {
  const items = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const response = await http.get(
      `${backendUrl}/user-management?offset=${offset}&limit=${limit}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = response.data || {};
    const pageItems = Array.isArray(data.items) ? data.items : [];
    items.push(...pageItems);
    total = Number.isFinite(Number(data.total)) ? Number(data.total) : items.length;
    if (pageItems.length < limit) break;
    offset += limit;
  }
  return items;
}

async function loginBrics(http, bricsRoot, adminLogin, adminPassword) {
  const loginPage = await http.get(`${bricsRoot}/InternetBanking/Account/Login`, {
    responseType: 'text',
  });
  const loginHtml = String(loginPage.data || '');
  const $ = cheerio.load(loginHtml);
  const token =
    $('input[name="__RequestVerificationToken"]').val() ||
    $('input[type="hidden"][name*="RequestVerificationToken"]').val() ||
    loginHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i)?.[1];
  if (!token) {
    throw new Error(
      `BRICS token not found on login page. Snippet=${loginHtml.slice(0, 300).replace(/\s+/g, ' ')}`,
    );
  }
  const body = new URLSearchParams();
  body.append('__RequestVerificationToken', token);
  body.append('UserName', adminLogin);
  body.append('Password', adminPassword);

  const response = await http.post(`${bricsRoot}/InternetBanking/Account/Login`, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      Referer: `${bricsRoot}/InternetBanking/Account/Login?ReturnUrl=%2FInternetBanking`,
      Origin: bricsRoot,
    },
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 400,
    responseType: 'text',
  });

  const cookies = (response.headers['set-cookie'] || [])
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

  if (!cookies) {
    throw new Error('BRICS cookies were not returned after login');
  }

  return cookies;
}

async function fetchSomAccountsByPhone(http, bricsRoot, cookies, phone) {
  const candidates = buildPhoneCandidates(phone);
  for (const candidate of candidates) {
    const response = await http.post(
      `${bricsRoot}/InternetBanking/ru-RU/Reference/GetAccountsByAccountNoOrPhone`,
      { account: candidate },
      {
        headers: {
          Cookie: cookies,
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        responseType: 'json',
      },
    );

    const accounts = uniqAccounts(
      extractRecords(response.data)
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

    if (accounts.length > 0) return accounts;
  }

  return [];
}

async function probeInternalTransactionPage(http, bricsRoot, cookies, accountNo) {
  const response = await http.get(
    `${bricsRoot}/InternetBanking/ru-RU/Accounts/InternalTransaction?Mode=Create&OperationType=InternalOperation&AccountNo=${encodeURIComponent(accountNo)}&CurrencyID=417`,
    {
      headers: {
        Cookie: cookies,
        Accept: 'text/html',
      },
      responseType: 'text',
    },
  );

  const body = String(response.data || '');
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
  const adminLogin = requireValue('ADMIN_LOGIN', args.adminLogin);
  const adminPassword = requireValue('ADMIN_PASSWORD', args.adminPassword);

  const http = axios.create({
    timeout: 30000,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    validateStatus: (status) => status >= 200 && status < 500,
  });

  console.log('[1/4] login backend');
  const backendToken = await loginBackend(http, backendUrl, adminLogin, adminPassword);

  console.log('[2/4] load users');
  const users = await loadAllUsers(http, backendUrl, backendToken, args.limit);
  const phoneUsers = users.filter((user) => String(user.phone || '').trim().length > 0);
  console.log(`users=${users.length} phoneUsers=${phoneUsers.length}`);

  console.log('[3/4] login brics');
  const cookies = await loginBrics(http, bricsRoot, adminLogin, adminPassword);

  console.log('[4/4] scan SOM accounts');
  const accounts = [];
  for (const user of phoneUsers) {
    const somAccounts = await fetchSomAccountsByPhone(http, bricsRoot, cookies, user.phone);
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
        ? await probeInternalTransactionPage(http, bricsRoot, cookies, account.AccountNo)
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
        console.log(
          `PAIR: ${a.AccountNo} (${a.customer_id}) <-> ${b.AccountNo} (${b.customer_id})`,
        );
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
