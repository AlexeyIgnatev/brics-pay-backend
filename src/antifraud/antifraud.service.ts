import { Injectable, Logger } from '@nestjs/common';
import { Asset, AntiFraudRuleKey, PrismaClient, TransactionKind } from '@prisma/client';
import { SettingsService } from '../config/settings/settings.service';
import { BybitExchangeService } from '../config/exchange/bybit.service';

export interface AntiFraudContext {
  kind: TransactionKind;
  amount: number;
  asset: Asset;
  sender_customer_id?: number;
  receiver_customer_id?: number;
}

@Injectable()
export class AntiFraudService {
  private readonly logger = new Logger(AntiFraudService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: SettingsService,
    private readonly exchange: BybitExchangeService,
  ) {}

  private async toSom(asset: Asset, amount: number): Promise<number> {
    if (asset === 'SOM' || asset === 'ESOM') return amount;
    const prices = await this.exchange.getUsdPrices(['BTC','ETH','USDT_TRC20'] as unknown as Asset[]);
    const esomPerUsd = Number((await this.settings.get()).esom_per_usd);
    const usd = amount * Number(prices[asset] || 0);
    return usd * esomPerUsd;
  }

  // ensure default rules exist (idempotent)
  async ensureDefaults(): Promise<void> {
    const upsert = async (key: AntiFraudRuleKey, data: any) => {
      await this.prisma.antiFraudRule.upsert({
        where: { key },
        create: { key, ...data },
        update: data,
      });
    };
    await upsert('FIAT_ANY_GE_1M', { threshold_som: '1000000', description: 'Любая операция с фиатом >= 1 000 000 сом' });
    await upsert('ONE_TIME_GE_8M', { threshold_som: '8000000', description: 'Разовая сделка >= 8 000 000 сом' });
    await upsert('FREQUENT_OPS_3_30D_EACH_GE_100K', { period_days: 30, min_count: 3, threshold_som: '100000', description: '>=3 операций за 30 дней, каждая >= 100k' });
    await upsert('WITHDRAW_AFTER_LARGE_INFLOW', { period_days: 7, percent_threshold: '50', threshold_som: '1000000', description: 'Вывод >=50% от поступления >=1млн в течение 7 дней' });
    await upsert('SPLITTING_TOTAL_14D_GE_1M', { period_days: 14, threshold_som: '1000000', description: 'Дробление: суммарно >=1 млн за 14 дней' });
    await upsert('THIRD_PARTY_DEPOSITS_3_30D_TOTAL_GE_1M', { period_days: 30, min_count: 3, threshold_som: '1000000', description: '>=3 внесения третьими лицами за 30 дней, общая сумма >=1млн' });
    await upsert('AFTER_INACTIVITY_6M', { period_days: 180, description: 'Активность после 6 месяцев' });
    await upsert('MANY_SENDERS_TO_ONE_10_PER_MONTH', { period_days: 30, min_count: 10, description: '>=10 переводов от разных физлиц на один счет за месяц' });
  }

  // returns triggered rule key if any
  async checkAndOpenCaseIfTriggered(txId: number, ctx: AntiFraudContext): Promise<AntiFraudRuleKey | null> {
    await this.ensureDefaults();
    const rules = await this.prisma.antiFraudRule.findMany({ where: { enabled: true } });
    const amountSom = await this.toSom(ctx.asset, ctx.amount);

    // Helper fetchers
    const now = new Date();
    const sinceDays = async (days: number) => {
      const d = new Date(now); d.setDate(d.getDate() - days); return d;
    };

    // Evaluate rules
    for (const r of rules) {
      switch (r.key) {
        case 'FIAT_ANY_GE_1M':
          if ((ctx.asset === 'SOM' || ctx.asset === 'ESOM') && amountSom >= Number(r.threshold_som || 0)) {
            return this.openCase(txId, r.key, `Fiat op >= ${r.threshold_som}`);
          }
          break;
        case 'ONE_TIME_GE_8M':
          if (amountSom >= Number(r.threshold_som || 0)) return this.openCase(txId, r.key, 'One time >= threshold');
          break;
        case 'FREQUENT_OPS_3_30D_EACH_GE_100K': {
          const from = await sinceDays(r.period_days || 30);
          const count = await this.prisma.transaction.count({
            where: {
              sender_customer_id: ctx.sender_customer_id,
              createdAt: { gte: from },
              amount_out: { gte: (r.threshold_som || '0') as any },
            }
          });
          if (count >= (r.min_count || 3)) return this.openCase(txId, r.key, `>=${r.min_count} ops each >=${r.threshold_som}`);
          break;
        }
        case 'WITHDRAW_AFTER_LARGE_INFLOW': {
          const from = await sinceDays(r.period_days || 7);
          // find max incoming within period
          const inflow = await this.prisma.transaction.aggregate({
            _sum: { amount_out: true },
            where: { receiver_customer_id: ctx.sender_customer_id, createdAt: { gte: from }, amount_out: { gte: (r.threshold_som || '0') as any } },
          });
          const inflowSom = Number(inflow._sum.amount_out || 0);
          if (inflowSom > 0 && amountSom >= inflowSom * Number(r.percent_threshold || 0) / 100) {
            return this.openCase(txId, r.key, 'Withdraw after large inflow');
          }
          break;
        }
        case 'SPLITTING_TOTAL_14D_GE_1M': {
          const from = await sinceDays(r.period_days || 14);
          const agg = await this.prisma.transaction.aggregate({ _sum: { amount_out: true }, where: { sender_customer_id: ctx.sender_customer_id, createdAt: { gte: from } } });
          const total = Number(agg._sum.amount_out || 0);
          if (total >= Number(r.threshold_som || 0)) return this.openCase(txId, r.key, 'Splitting over period');
          break;
        }
        case 'THIRD_PARTY_DEPOSITS_3_30D_TOTAL_GE_1M': {
          const from = await sinceDays(r.period_days || 30);
          const deposits = await this.prisma.transaction.groupBy({
            by: ['sender_customer_id'],
            where: { receiver_customer_id: ctx.receiver_customer_id, createdAt: { gte: from } },
            _sum: { amount_out: true },
          });
          const uniqueSenders = deposits.filter(d => Number(d._sum.amount_out || 0) > 0).length;
          const total = deposits.reduce((s,d) => s + Number(d._sum.amount_out || 0), 0);
          if (uniqueSenders >= (r.min_count || 3) && total >= Number(r.threshold_som || 0)) return this.openCase(txId, r.key, 'Third party deposits');
          break;
        }
        case 'AFTER_INACTIVITY_6M': {
          const from = await sinceDays(r.period_days || 180);
          const last = await this.prisma.transaction.findFirst({
            where: { sender_customer_id: ctx.sender_customer_id },
            orderBy: { createdAt: 'desc' },
          });
          if (!last || last.createdAt < from) return this.openCase(txId, r.key, 'After long inactivity');
          break;
        }
        case 'MANY_SENDERS_TO_ONE_10_PER_MONTH': {
          const from = await sinceDays(r.period_days || 30);
          const senders = await this.prisma.transaction.groupBy({
            by: ['sender_customer_id'],
            where: { receiver_customer_id: ctx.receiver_customer_id, createdAt: { gte: from } },
            _count: { sender_customer_id: true },
          });
          if (senders.length >= (r.min_count || 10)) return this.openCase(txId, r.key, 'Many senders to one account');
          break;
        }
      }
    }
    return null;
  }

  private async openCase(txId: number, key: AntiFraudRuleKey, reason: string): Promise<AntiFraudRuleKey> {
    await this.prisma.antiFraudCase.create({ data: { transaction_id: txId, rule_key: key, reason } });
    return key;
  }
}
