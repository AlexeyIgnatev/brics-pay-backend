import { Injectable, Logger } from '@nestjs/common';
/* eslint-disable max-classes-per-file */

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
  // CRUD/read helpers for controller
  async listRules() { return this.prisma.antiFraudRule.findMany({ orderBy: { key: 'asc' } }); }
  async updateRule(key: AntiFraudRuleKey, data: any) { return this.prisma.antiFraudRule.update({ where: { key }, data }); }
  async listOpenCases() { return this.prisma.antiFraudCase.findMany({ where: { status: 'OPEN' as any }, include: { transaction: true } }); }
  async adminApprove(id: number) {
    const c = await this.prisma.antiFraudCase.findUnique({ where: { id }, include: { transaction: true } });
    if (!c) return null;
    const t = c.transaction;
    let bankId: number | null = t.bank_op_id ?? null;
    if (t.kind === 'BANK_TO_BANK' && t.status === 'PENDING' && !t.bank_op_id) {
      // БРИКС операция выполняется в контроллере антифрода ранее, но оставим на сервисе для консистентности
      // Здесь нет доступа к BricsService, поэтому approve из контроллера уже покрыт (или можно инжектить BricsService сюда).
    }
    await this.prisma.$transaction([
      this.prisma.transaction.update({ where: { id: c.transaction_id }, data: { status: 'SUCCESS' as any, bank_op_id: bankId ?? undefined } }),
      this.prisma.antiFraudCase.update({ where: { id: c.id }, data: { status: 'APPROVED' as any } }),
    ]);
    if (t.kind === 'BANK_TO_BANK') {
      await this.prisma.userAssetBalance.upsert({
        where: { customer_id_asset: { customer_id: t.receiver_customer_id!, asset: 'SOM' as Asset } },
        create: { customer_id: t.receiver_customer_id!, asset: 'SOM' as Asset, balance: t.amount_out as any },
        update: { balance: { increment: t.amount_out as any } },
      });
    }
    return { ok: true };
  }
  async adminReject(id: number) {
    const c = await this.prisma.antiFraudCase.findUnique({ where: { id }, include: { transaction: true } });
    if (!c) return null;
    const t = c.transaction;
    if (t.kind === 'BANK_TO_BANK') {
      await this.prisma.userAssetBalance.upsert({
        where: { customer_id_asset: { customer_id: t.sender_customer_id!, asset: 'SOM' as Asset } },
        create: { customer_id: t.sender_customer_id!, asset: 'SOM' as Asset, balance: t.amount_out as any },
        update: { balance: { increment: t.amount_out as any } },
      });
    }
    await this.prisma.$transaction([
      this.prisma.transaction.update({ where: { id: c.transaction_id }, data: { status: 'REJECTED' as any } }),
      this.prisma.antiFraudCase.update({ where: { id: c.id }, data: { status: 'REJECTED' as any } }),
    ]);
    return { ok: true };
  }

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
    await upsert('FIAT_ANY_GE_1M', { threshold_som: '1000000' });
    await upsert('ONE_TIME_GE_8M', { threshold_som: '8000000' });
    await upsert('FREQUENT_OPS_3_30D_EACH_GE_100K', { period_days: 30, min_count: 3, threshold_som: '100000' });
    await upsert('WITHDRAW_AFTER_LARGE_INFLOW', { period_days: 7, percent_threshold: '50', threshold_som: '1000000' });
    await upsert('SPLITTING_TOTAL_14D_GE_1M', { period_days: 14, threshold_som: '1000000' });
    await upsert('THIRD_PARTY_DEPOSITS_3_30D_TOTAL_GE_1M', { period_days: 30, min_count: 3, threshold_som: '1000000' });
    await upsert('AFTER_INACTIVITY_6M', { period_days: 180 });
    await upsert('MANY_SENDERS_TO_ONE_10_PER_MONTH', { period_days: 30, min_count: 10 });
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
