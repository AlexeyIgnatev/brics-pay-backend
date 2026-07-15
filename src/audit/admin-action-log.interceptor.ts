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

    const beforeSettingsPromise = isAdminSettingsUpdate
      ? this.prisma.settings
          .findFirst({ orderBy: { id: 'asc' } })
          .catch(() => null)
      : Promise.resolve(null);

    return next.handle().pipe(
      tap(async () => {
        if (!shouldLog) return;
        try {
          const beforeSettings = await beforeSettingsPromise;
          if (isAdminSettingsUpdate) {
            routeDetails.diff = buildAdminSettingsDiff(beforeSettings, req.body);
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
