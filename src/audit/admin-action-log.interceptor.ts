import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../config/prisma/prisma.service';

const ADMIN_SETTINGS_DIFF_FIELDS = [
  'esom_per_usd',
  'usd_buy_rate',
  'usd_sell_rate',
  'esom_som_conversion_fee_pct',
  'esom_som_conversion_fee_min',
  'usdt_trade_fee_pct',
  'usdt_withdraw_fee_fixed',
  'min_withdraw_usdt_trc20',
  'rates_change_reasons_json',
  'bank_fee_posting_time_bishkek',
  'central_bank_som_account',
  'central_bank_salam_wallet',
  'central_bank_usdt_wallet',
  'bank_commission_central_bank_pct',
  'bank_commission_bank_pct',
  'bank_commission_partners_pct',
  'bank_commission_distribution_mode',
  'bank_commission_central_bank_fixed',
  'bank_commission_bank_fixed',
  'bank_commission_partners_fixed',
  'bank_som_account',
  'bank_salam_wallet',
  'bank_usdt_wallet',
  'bank_commission_partners_json',
] as const;

const ADMIN_SETTINGS_DIFF_LABELS: Record<string, string> = {
  esom_per_usd: 'Курс ESOM/USD',
  usd_buy_rate: 'Курс покупки USD',
  usd_sell_rate: 'Курс продажи USD',
  esom_som_conversion_fee_pct: 'Комиссия СОМ',
  esom_som_conversion_fee_min: 'Мин. комиссия СОМ',
  usdt_trade_fee_pct: 'Комиссия USDT',
  usdt_withdraw_fee_fixed: 'Вывод USDT',
  min_withdraw_usdt_trc20: 'Мин. вывод USDT',
  rates_change_reasons_json: 'Причины курсов',
  bank_fee_posting_time_bishkek: 'Время',
  central_bank_som_account: 'Счёт ЦБ',
  central_bank_salam_wallet: 'Кошелёк SALAM ЦБ',
  central_bank_usdt_wallet: 'Кошелёк USDT ЦБ',
  bank_commission_central_bank_pct: 'ЦБ %',
  bank_commission_bank_pct: 'Банк %',
  bank_commission_partners_pct: 'Партнёры %',
  bank_commission_distribution_mode: 'Режим',
  bank_commission_central_bank_fixed: 'ЦБ фикс.',
  bank_commission_bank_fixed: 'Банк фикс.',
  bank_commission_partners_fixed: 'Партнёры фикс.',
  bank_som_account: 'Счёт банка',
  bank_salam_wallet: 'Кошелёк SALAM банка',
  bank_usdt_wallet: 'Кошелёк USDT банка',
  bank_commission_partners_json: 'Партнёры',
};

type AdminSettingsDiffEntry = {
  key: string;
  label: string;
  before: string;
  after: string;
};

type TariffDiffChangeEntry = {
  field: 'percent_fee' | 'fixed_fee';
  before: string;
  after: string;
};

type TariffDiffEntry = {
  key: string;
  label: string;
  category: string;
  residency: string;
  operation: string;
  before: {
    percent_fee: string;
    fixed_fee: string;
  };
  after: {
    percent_fee: string;
    fixed_fee: string;
  };
  changes: TariffDiffChangeEntry[];
};

function normalizeDiffValue(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function buildAdminSettingsDiff(before: any, after: any) {
  if (!after || typeof after !== 'object') return [];

  return ADMIN_SETTINGS_DIFF_FIELDS
    .map((key) => {
      const next = normalizeDiffValue(after[key]);
      const prev = normalizeDiffValue(before?.[key]);
      if (!next && !prev) return null;
      if (next === prev) return null;
      return {
        key,
        label: ADMIN_SETTINGS_DIFF_LABELS[key] || key,
        before: prev,
        after: next,
      };
    })
    .filter(Boolean) as AdminSettingsDiffEntry[];
}

function tariffDiffLabel(operation: string): string {
  const labels: Record<string, string> = {
    SOM_TO_ESOM: 'СОМ в SALAM',
    ESOM_TO_SOM: 'SALAM в СОМ',
    WALLET_TRANSFER_ESOM: 'Внутр. SALAM',
    ESOM_TO_USDT_TRC20: 'SALAM в USDT',
    USDT_TRC20_TO_ESOM: 'USDT в SALAM',
    WALLET_TRANSFER_USDT_TRC20: 'Внутр. USDT',
  };
  return labels[operation] || operation;
}

function buildTariffDiff(before: any, after: any) {
  const afterItems = Array.isArray(after)
    ? after
    : Array.isArray(after?.items)
      ? after.items
      : [];
  const beforeItems = Array.isArray(before)
    ? before
    : Array.isArray(before?.items)
      ? before.items
      : [];

  const beforeByKey = new Map(
    beforeItems
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const category = String((item as any).category ?? '');
        const residency = String((item as any).residency ?? '');
        const operation = String((item as any).operation ?? '');
        return [
          `${category}:${residency}:${operation}`,
          item as Record<string, any>,
        ] as const;
      }),
  );

  return afterItems
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const row = item as Record<string, any>;
      const category = String(row.category ?? '');
      const residency = String(row.residency ?? '');
      const operation = String(row.operation ?? '');
      if (!operation) return null;

      const prev = beforeByKey.get(`${category}:${residency}:${operation}`);
      const previousRow = prev as Record<string, any> | undefined;
      const nextPercent = normalizeDiffValue(row.percent_fee);
      const nextFixed = normalizeDiffValue(row.fixed_fee);
      const prevPercent = normalizeDiffValue(previousRow?.percent_fee);
      const prevFixed = normalizeDiffValue(previousRow?.fixed_fee);

      const changes: TariffDiffChangeEntry[] = [];
      if (nextPercent !== prevPercent) {
        changes.push({
          field: 'percent_fee',
          before: prevPercent,
          after: nextPercent,
        });
      }
      if (nextFixed !== prevFixed) {
        changes.push({
          field: 'fixed_fee',
          before: prevFixed,
          after: nextFixed,
        });
      }

      if (!changes.length) return null;

      return {
        key: `${category}:${residency}:${operation}`,
        label: tariffDiffLabel(operation),
        category,
        residency,
        operation,
        before: {
          percent_fee: prevPercent,
          fixed_fee: prevFixed,
        },
        after: {
          percent_fee: nextPercent,
          fixed_fee: nextFixed,
        },
        changes,
      } satisfies TariffDiffEntry;
    })
    .filter(Boolean);
}

function getClientIp(req: any): string {
  const xf = (req.headers?.['x-forwarded-for'] as string) || '';
  if (xf) return xf.split(',')[0].trim();
  return (
    req.ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function sanitize(obj: any): any {
  const blacklist = new Set([
    'password',
    'password_hash',
    'private_key',
    'accessToken',
    'refreshToken',
  ]);
  const recur = (val: any): any => {
    if (val == null) return val;
    if (Array.isArray(val)) return val.map(recur);
    if (typeof val === 'object') {
      const out: any = {};
      for (const [k, v] of Object.entries(val)) {
        out[k] = blacklist.has(k) ? '[REDACTED]' : recur(v);
      }
      return out;
    }
    return val;
  };
  return recur(obj);
}

@Injectable()
export class AdminActionLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const admin = req?.admin;
    const method = (req?.method || '').toUpperCase();

    const shouldLog = !!admin && method !== 'GET';
    const ip = getClientIp(req);
    const url = (req?.originalUrl || req?.url || '').split('?')[0];

    const routeDetails: Record<string, unknown> = {
      params: req?.params,
      query: req?.query,
      body: req?.body,
    };

    const isAdminSettingsUpdate =
      method === 'PUT' &&
      url === '/blockchain-config/admin-settings' &&
      req?.body &&
      typeof req.body === 'object';
    const isTariffsUpdate =
      method === 'PUT' &&
      url === '/blockchain-config/tariffs' &&
      req?.body &&
      typeof req.body === 'object';

    const beforeSettingsPromise = isAdminSettingsUpdate
      ? this.prisma.settings
          .findFirst({ orderBy: { id: 'asc' } })
          .catch(() => null)
      : Promise.resolve(null);
    const beforeTariffsPromise = isTariffsUpdate
      ? this.prisma.tariffSetting
          .findMany({
            orderBy: [
              { category: 'asc' },
              { residency: 'asc' },
              { operation: 'asc' },
            ],
          })
          .catch(() => [])
      : Promise.resolve(null);

    return next.handle().pipe(
      tap(async () => {
        if (!shouldLog) return;
        try {
          const beforeSettings = await beforeSettingsPromise;
          const beforeTariffs = await beforeTariffsPromise;
          if (isAdminSettingsUpdate) {
            routeDetails.diff = buildAdminSettingsDiff(beforeSettings, req.body);
          } else if (isTariffsUpdate) {
            routeDetails.diff = buildTariffDiff(beforeTariffs, req.body);
          }

          await this.prisma.adminActionLog.create({
            data: {
              admin_id: Number(admin.id),
              ip,
              action: `${method} ${url}`,
              details: JSON.stringify(sanitize(routeDetails)),
            },
          });
        } catch (_) {}
      }),
    );
  }
}
