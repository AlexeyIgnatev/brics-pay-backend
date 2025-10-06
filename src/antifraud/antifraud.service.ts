import { Injectable, Logger } from '@nestjs/common';
/* eslint-disable max-classes-per-file */
import { AntiFraudRuleKey, Asset, PrismaClient, TransactionKind } from '@prisma/client';
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
  async listRules() {
    await this.ensureDefaults();
    return this.prisma.antiFraudRule.findMany({ orderBy: { key: 'asc' } });
  }

  async updateRule(key: AntiFraudRuleKey, data: any) {
    return this.prisma.antiFraudRule.update({ where: { key }, data });
  }

  async listCases(query: any): Promise<{ total: number; offset: number; limit: number; items: any[] }> {
    const whereCase: any = {};
    if (query.case_status) whereCase.status = query.case_status;

    const whereTx: any = {};
    if (query.kind?.length) whereTx.kind = { in: query.kind };
    if (query.status?.length) whereTx.status = { in: query.status };
    if (query.asset?.length) whereTx.OR = [{ asset_out: { in: query.asset } }, { asset_in: { in: query.asset } }];
    if (query.tx_hash) whereTx.tx_hash = { contains: query.tx_hash };
    if (query.id) whereTx.bank_op_id = query.id;
    if (query.amount_min != null || query.amount_max != null) {
      whereTx.amount_out = {};
      if (query.amount_min != null) whereTx.amount_out.gte = query.amount_min.toString();
      if (query.amount_max != null) whereTx.amount_out.lte = query.amount_max.toString();
    }
    if (query.date_from || query.date_to) {
      whereTx.createdAt = {};
      if (query.date_from) whereTx.createdAt.gte = new Date(query.date_from);
      if (query.date_to) whereTx.createdAt.lte = new Date(query.date_to);
    }

    if (query.sender) {
      whereTx.OR = whereTx.OR || [];
      whereTx.OR.push(
        { sender_wallet_address: { contains: query.sender, mode: 'insensitive' } },
        {
          sender_customer: {
            OR: [
              { first_name: { contains: query.sender, mode: 'insensitive' } },
              { middle_name: { contains: query.sender, mode: 'insensitive' } },
              { last_name: { contains: query.sender, mode: 'insensitive' } },
              { phone: { contains: query.sender, mode: 'insensitive' } },
              { email: { contains: query.sender, mode: 'insensitive' } },
            ],
          },
        },
      );
    }
    if (query.receiver) {
      whereTx.OR = whereTx.OR || [];
      whereTx.OR.push(
        { receiver_wallet_address: { contains: query.receiver, mode: 'insensitive' } },
        {
          receiver_customer: {
            OR: [
              { first_name: { contains: query.receiver, mode: 'insensitive' } },
              { middle_name: { contains: query.receiver, mode: 'insensitive' } },
              { last_name: { contains: query.receiver, mode: 'insensitive' } },
              { phone: { contains: query.receiver, mode: 'insensitive' } },
              { email: { contains: query.receiver, mode: 'insensitive' } },
            ],
          },
        },
      );
    }

    const sortBy = (query.sort_by === 'amount' ? 'amount_out' : query.sort_by) ?? 'createdAt';
    const sortDir = query.sort_dir ?? 'desc';

    const [total, items] = await this.prisma.$transaction([
      this.prisma.antiFraudCase.count({ where: { ...whereCase, transaction: whereTx } }),
      this.prisma.antiFraudCase.findMany({
        where: { ...whereCase, transaction: whereTx },
        orderBy: { createdAt: 'desc' },
        skip: query.offset ?? 0,
        take: query.limit ?? 20,
        include: { transaction: { include: { sender_customer: true, receiver_customer: true } } },
      }),
    ]);

    const caseItems = items.map((c: any) => ({
      id: c.id,
      status: c.status,
      rule_key: c.rule_key,
      reason: c.reason,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      transaction: {
        id: c.transaction.id,
        kind: c.transaction.kind,
        status: c.transaction.status,
        amount: Number(c.transaction.amount_out),
        asset: c.transaction.asset_out,
        tx_hash: c.transaction.tx_hash ?? undefined,
        bank_op_id: c.transaction.bank_op_id ?? undefined,
        sender_customer_id: c.transaction.sender_customer_id ?? undefined,
        receiver_customer_id: c.transaction.receiver_customer_id ?? undefined,
        sender_wallet_address: c.transaction.sender_wallet_address ?? undefined,
        receiver_wallet_address: c.transaction.receiver_wallet_address ?? undefined,
        comment: c.transaction.comment ?? undefined,
        createdAt: c.transaction.createdAt,
        sender_customer: c.transaction.sender_customer ? {
          customer_id: c.transaction.sender_customer.customer_id,
          first_name: c.transaction.sender_customer.first_name ?? undefined,
          middle_name: c.transaction.sender_customer.middle_name ?? undefined,
          last_name: c.transaction.sender_customer.last_name ?? undefined,
          phone: c.transaction.sender_customer.phone ?? undefined,
          email: c.transaction.sender_customer.email ?? undefined,
        } : undefined,
        receiver_customer: c.transaction.receiver_customer ? {
          customer_id: c.transaction.receiver_customer.customer_id,
          first_name: c.transaction.receiver_customer.first_name ?? undefined,
          middle_name: c.transaction.receiver_customer.middle_name ?? undefined,
          last_name: c.transaction.receiver_customer.last_name ?? undefined,
          phone: c.transaction.receiver_customer.phone ?? undefined,
          email: c.transaction.receiver_customer.email ?? undefined,
        } : undefined,
      },
    }));

    return { total, offset: query.offset ?? 0, limit: query.limit ?? 20, items: caseItems };
  }

  async adminApprove(id: number) {
    const c = await this.prisma.antiFraudCase.findUnique({ where: { id }, include: { transaction: true } });
    if (!c) return null;
    // Банковский стиль: никакие операции не выполняем, транзакция остаётся REJECTED.
    await this.prisma.antiFraudCase.update({ where: { id: c.id }, data: { status: 'APPROVED' } });
    return { ok: true };
  }

  async adminReject(id: number) {
    const c = await this.prisma.antiFraudCase.findUnique({ where: { id }, include: { transaction: true } });
    if (!c) return null;
    // Ничего не откатываем: транзакция уже REJECTED, просто фиксируем решение кейса
    await this.prisma.antiFraudCase.update({ where: { id: c.id }, data: { status: 'REJECTED' } });
    return { ok: true };
  }

  private readonly logger = new Logger(AntiFraudService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: SettingsService,
    private readonly exchange: BybitExchangeService,
  ) {
  }

  private async toSom(asset: Asset, amount: number): Promise<number> {
    if (asset === 'SOM' || asset === 'ESOM') return amount;
    const prices = await this.exchange.getUsdPrices(['BTC', 'ETH', 'USDT_TRC20'] as unknown as Asset[]);
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

  // Evaluate without creating a case; returns triggered rule key or null
  async evaluateTriggered(ctx: AntiFraudContext): Promise<AntiFraudRuleKey | null> {
    await this.ensureDefaults();
    const rules = await this.prisma.antiFraudRule.findMany({ where: { enabled: true } });
    const amountSom = await this.toSom(ctx.asset, ctx.amount);

    const now = new Date();
    const sinceDays = async (days: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - days);
      return d;
    };

    for (const r of rules) {
      switch (r.key) {
        case 'FIAT_ANY_GE_1M':
          if ((ctx.asset === 'SOM' || ctx.asset === 'ESOM') && amountSom >= Number(r.threshold_som || 0)) return r.key;
          break;
        case 'ONE_TIME_GE_8M':
          if (amountSom >= Number(r.threshold_som || 0)) return r.key;
          break;
        case 'FREQUENT_OPS_3_30D_EACH_GE_100K': {
          const from = await sinceDays(r.period_days || 30);
          const count = await this.prisma.transaction.count({
            where: {
              sender_customer_id: ctx.sender_customer_id,
              createdAt: { gte: from },
              amount_out: { gte: (r.threshold_som || '0') },
            },
          });
          if (count >= (r.min_count || 3)) return r.key;
          break;
        }
        case 'WITHDRAW_AFTER_LARGE_INFLOW': {
          const from = await sinceDays(r.period_days || 7);
          const inflow = await this.prisma.transaction.aggregate({
            _sum: { amount_out: true },
            where: {
              receiver_customer_id: ctx.sender_customer_id,
              createdAt: { gte: from },
              amount_out: { gte: (r.threshold_som || '0') },
            },
          });
          const inflowSom = Number(inflow._sum.amount_out || 0);
          if (inflowSom > 0 && amountSom >= (inflowSom * Number(r.percent_threshold || 0)) / 100) return r.key;
          break;
        }
        case 'SPLITTING_TOTAL_14D_GE_1M': {
          const from = await sinceDays(r.period_days || 14);
          const agg = await this.prisma.transaction.aggregate({
            _sum: { amount_out: true },
            where: { sender_customer_id: ctx.sender_customer_id, createdAt: { gte: from } },
          });
          const total = Number(agg._sum.amount_out || 0);
          if (total >= Number(r.threshold_som || 0)) return r.key;
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
          const total = deposits.reduce((s, d) => s + Number(d._sum.amount_out || 0), 0);
          if (uniqueSenders >= (r.min_count || 3) && total >= Number(r.threshold_som || 0)) return r.key;
          break;
        }
        case 'AFTER_INACTIVITY_6M': {
          const from = await sinceDays(r.period_days || 180);
          const last = await this.prisma.transaction.findFirst({
            where: { sender_customer_id: ctx.sender_customer_id },
            orderBy: { createdAt: 'desc' },
          });
          if (!last || last.createdAt < from) return r.key;
          break;
        }
        case 'MANY_SENDERS_TO_ONE_10_PER_MONTH': {
          const from = await sinceDays(r.period_days || 30);
          const senders = await this.prisma.transaction.groupBy({
            by: ['sender_customer_id'],
            where: { receiver_customer_id: ctx.receiver_customer_id, createdAt: { gte: from } },
            _count: { sender_customer_id: true },
          });
          if (senders.length >= (r.min_count || 10)) return r.key;
          break;
        }
      }
    }
    return null;
  }

  // Check if there exists an approved antifraud case for an identical transaction
  async hasApprovedIdentical(plan: {
    kind: TransactionKind;
    sender_customer_id?: number;
    receiver_customer_id?: number;
    asset_in: Asset;
    amount_in: number;
    asset_out: Asset;
    receiver_wallet_address?: string | null;
    external_address?: string | null;
  }): Promise<boolean> {
    const whereTx: any = {
      kind: plan.kind,
      sender_customer_id: plan.sender_customer_id,
      asset_in: plan.asset_in,
      amount_in: plan.amount_in.toString(),
      asset_out: plan.asset_out,
    };
    if (plan.receiver_customer_id) whereTx.receiver_customer_id = plan.receiver_customer_id;
    if (plan.receiver_wallet_address) whereTx.receiver_wallet_address = plan.receiver_wallet_address;
    if (plan.external_address) whereTx.external_address = plan.external_address;
    const prev = await this.prisma.transaction.findFirst({ where: whereTx, orderBy: { createdAt: 'desc' } });
    if (!prev) return false;
    const caseApproved = await this.prisma.antiFraudCase.findFirst({
      where: {
        transaction_id: prev.id,
        status: 'APPROVED',
      },
    });
    return !!caseApproved;
  }

  // Main decision method: true -> allow; false -> blocked and recorded
  async shouldAllowTransaction(plan: {
    kind: TransactionKind;
    amount_in: number;
    asset_in: Asset;
    amount_out?: number;
    asset_out: Asset;
    sender_customer_id?: number;
    receiver_customer_id?: number;
    receiver_wallet_address?: string | null;
    external_address?: string | null;
    comment?: string;
  }): Promise<boolean> {
    const amount = plan.amount_out ?? plan.amount_in;
    const asset = plan.asset_out ?? plan.asset_in;
    const key = await this.evaluateTriggered({
      kind: plan.kind,
      amount,
      asset,
      sender_customer_id: plan.sender_customer_id,
      receiver_customer_id: plan.receiver_customer_id,
    });
    if (!key) return true;
    const approvedBefore = await this.hasApprovedIdentical({
      kind: plan.kind,
      sender_customer_id: plan.sender_customer_id,
      receiver_customer_id: plan.receiver_customer_id,
      asset_in: plan.asset_in,
      amount_in: plan.amount_in,
      asset_out: plan.asset_out,
      receiver_wallet_address: plan.receiver_wallet_address,
      external_address: plan.external_address,
    });
    if (approvedBefore) return true;
    const tx = await this.prisma.transaction.create({
      data: ({
        kind: plan.kind,
        status: 'REJECTED',
        amount_in: plan.amount_in.toString(),
        asset_in: plan.asset_in,
        amount_out: (plan.amount_out ?? plan.amount_in).toString(),
        asset_out: plan.asset_out,
        sender_customer_id: plan.sender_customer_id,
        receiver_customer_id: plan.receiver_customer_id,
        receiver_wallet_address: plan.receiver_wallet_address ?? undefined,
        external_address: plan.external_address ?? undefined,
        comment: plan.comment ?? 'Rejected by anti-fraud',
      }),
    });
    await this.openCase(tx.id, key, 'Triggered by antifraud rule');
    return false;
  }

  private async openCase(txId: number, key: AntiFraudRuleKey, reason: string): Promise<AntiFraudRuleKey> {
    await this.prisma.antiFraudCase.create({ data: { transaction_id: txId, rule_key: key, reason } });
    return key;
  }
}
