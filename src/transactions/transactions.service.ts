import { Injectable } from '@nestjs/common';
import { Asset, Prisma, PrismaClient, TransactionKind, TransactionStatus } from '@prisma/client';
import { TransactionsListDto, TransactionsListResponseDto } from './dto/transactions-list.dto';
import { TransactionsStatsQueryDto, TransactionsStatsResponseDto, TransactionsStatsSeriesPointDto, TransactionsStatsSummaryDto, TransactionsStatsTodayDto } from './dto/transactions-stats.dto';
import { SettingsService } from '../config/settings/settings.service';
import { BybitExchangeService } from '../config/exchange/bybit.service';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: SettingsService,
    private readonly exchange: BybitExchangeService,
  ) {}

  async list(query: TransactionsListDto): Promise<TransactionsListResponseDto> {
    const where: Prisma.TransactionWhereInput = {};

    if (query.kind?.length) where.kind = { in: query.kind as TransactionKind[] };
    if (query.status?.length) where.status = { in: query.status as TransactionStatus[] };
    if (query.asset?.length) where.OR = [
      { asset_in: { in: query.asset as Asset[] } },
    ];
    if (query.tx_hash) where.tx_hash = { contains: query.tx_hash };
    if (query.id) where.bank_op_id = query.id;
    if (query.amount_min != null || query.amount_max != null) {
      where.amount_in = {} as { gte?: string; lte?: string };
      if (query.amount_min != null) (where.amount_in as { gte?: string }).gte = query.amount_min.toString();
      if (query.amount_max != null) (where.amount_in as { lte?: string }).lte = query.amount_max.toString();
    }
    if (query.date_from || query.date_to) {
      where.createdAt = {} as { gte?: Date; lte?: Date };
      if (query.date_from) (where.createdAt as { gte?: Date }).gte = new Date(query.date_from);
      if (query.date_to) (where.createdAt as { lte?: Date }).lte = new Date(query.date_to);
    }

    if (query.sender) {
      where.OR = where.OR || [];
      (where.OR as Prisma.TransactionWhereInput[]).push(
        { sender_wallet_address: { contains: query.sender, mode: 'insensitive' } },
        { sender_customer: { OR: [
          { first_name: { contains: query.sender, mode: 'insensitive' } },
          { middle_name: { contains: query.sender, mode: 'insensitive' } },
          { last_name: { contains: query.sender, mode: 'insensitive' } },
          { phone: { contains: query.sender, mode: 'insensitive' } },
          { email: { contains: query.sender, mode: 'insensitive' } },
        ] } }
      );
    }
    if (query.receiver) {
      where.OR = where.OR || [];
      (where.OR as Prisma.TransactionWhereInput[]).push(
        { receiver_wallet_address: { contains: query.receiver, mode: 'insensitive' } },
        { receiver_customer: { OR: [
          { first_name: { contains: query.receiver, mode: 'insensitive' } },
          { middle_name: { contains: query.receiver, mode: 'insensitive' } },
          { last_name: { contains: query.receiver, mode: 'insensitive' } },
          { phone: { contains: query.receiver, mode: 'insensitive' } },
          { email: { contains: query.receiver, mode: 'insensitive' } },
        ] } }
      );
    }

    const orderBy: Prisma.TransactionOrderByWithRelationInput = {};
    const sortBy = (query.sort_by === 'amount' ? 'amount_in' : query.sort_by) ?? 'createdAt';
    const sortDir = query.sort_dir ?? 'desc';
    (orderBy as Record<string, 'asc' | 'desc'>)[sortBy] = sortDir;

    const [total, itemsRaw] = await this.prisma.$transaction([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        orderBy,
        skip: query.offset ?? 0,
        take: query.limit ?? 20,
        include: {
          sender_customer: true,
          receiver_customer: true,
        }
      })
    ]);

    
    const items = itemsRaw.map(t => ({
      id: t.id,
      kind: t.kind as unknown as string,
      status: t.status as unknown as string,
      amount: Number(t.amount_in),
      asset: t.asset_in as unknown as string,
      tx_hash: t.tx_hash ?? undefined,
      bank_op_id: t.bank_op_id ?? undefined,
      sender_customer_id: t.sender_customer_id ?? undefined,
      receiver_customer_id: t.receiver_customer_id ?? undefined,
      sender_wallet_address: t.sender_wallet_address ?? undefined,
      receiver_wallet_address: t.receiver_wallet_address ?? undefined,
      comment: t.comment ?? undefined,
      createdAt: t.createdAt,
      sender_customer: t.sender_customer ? {
        customer_id: t.sender_customer.customer_id,
        first_name: t.sender_customer.first_name ?? undefined,
        middle_name: t.sender_customer.middle_name ?? undefined,
        last_name: t.sender_customer.last_name ?? undefined,
        phone: t.sender_customer.phone ?? undefined,
        email: t.sender_customer.email ?? undefined,
      } : undefined,
      receiver_customer: t.receiver_customer ? {
        customer_id: t.receiver_customer.customer_id,
        first_name: t.receiver_customer.first_name ?? undefined,
        middle_name: t.receiver_customer.middle_name ?? undefined,
        last_name: t.receiver_customer.last_name ?? undefined,
        phone: t.receiver_customer.phone ?? undefined,
        email: t.receiver_customer.email ?? undefined,
      } : undefined,
    }));

    return { total, items, offset: query.offset ?? 0, limit: query.limit ?? 20 };
  }

  async stats(query: TransactionsStatsQueryDto): Promise<TransactionsStatsResponseDto> {
    const where: Prisma.TransactionWhereInput = {};
    if (query.kind?.length) where.kind = { in: query.kind as TransactionKind[] };
    if (query.status?.length) where.status = { in: query.status as TransactionStatus[] };
    if (query.asset?.length) where.OR = [
      { asset_in: { in: query.asset as Asset[] } },
    ];
    if (query.date_from || query.date_to) {
      where.createdAt = {} as { gte?: Date; lte?: Date };
      if (query.date_from) (where.createdAt as { gte?: Date }).gte = new Date(query.date_from);
      if (query.date_to) (where.createdAt as { lte?: Date }).lte = new Date(query.date_to);
    }

    const txs = await this.prisma.transaction.findMany({
      where,
      select: { id: true, createdAt: true, amount_in: true, asset_in: true },
      orderBy: { createdAt: 'asc' },
    });

    // prices for crypto now
    const prices = await this.exchange.getUsdPrices(['BTC', 'ETH', 'USDT_TRC20'] as Asset[]);
    const esomPerUsd = Number((await this.settings.get()).esom_per_usd);
    const toSom = (asset: Asset, amount: string | number): number => {
      const amt = Number(amount || 0);
      if (!amt) return 0;
      if (asset === 'SOM' || asset === 'ESOM') return amt;
      const usd = amt * Number(prices[asset] ?? 0);
      return usd * esomPerUsd;
    };

    // group helper
    const keyFor = (d: Date): string => {
      const dt = new Date(d);
      if (query.group_by === 'month') {
        dt.setDate(1); dt.setHours(0,0,0,0);
      } else if (query.group_by === 'week') {
        const day = dt.getDay(); // 0=Sun
        const diff = (day + 6) % 7; // Monday as start
        dt.setDate(dt.getDate() - diff); dt.setHours(0,0,0,0);
      } else { // day
        dt.setHours(0,0,0,0);
      }
      return dt.toISOString();
    };

    const seriesMap = new Map<string, { sum: number; count: number }>();
    const perCurrencySum = new Map<string, number>();
    const perCurrencyCount = new Map<string, number>();

    let totalSumSom = 0;
    for (const t of txs) {
      const som = toSom(t.asset_in as Asset, t.amount_in as unknown as string);
      totalSumSom += som;
      const k = keyFor(t.createdAt);
      const cur = seriesMap.get(k) || { sum: 0, count: 0 };
      cur.sum += som;
      cur.count += 1;
      seriesMap.set(k, cur);

      const a = t.asset_in as string;
      perCurrencySum.set(a, (perCurrencySum.get(a) || 0) + som);
      perCurrencyCount.set(a, (perCurrencyCount.get(a) || 0) + 1);
    }

    const series: TransactionsStatsSeriesPointDto[] = Array.from(seriesMap.entries())
      .sort((a,b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date, value: query.metric === 'count' ? v.count : v.sum }));

    const totalCount = txs.length;
    const topBySum = Array.from(perCurrencySum.entries()).sort((a,b) => b[1]-a[1])[0]?.[0];
    const topByCount = Array.from(perCurrencyCount.entries()).sort((a,b) => b[1]-a[1])[0]?.[0];

    // most active day by count
    const dayCounts = new Map<string, number>();
    for (const t of txs) {
      const dayKey = keyFor(t.createdAt instanceof Date ? t.createdAt : new Date(t.createdAt));
      dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
    }
    const mostActiveDay = Array.from(dayCounts.entries()).sort((a,b) => b[1]-a[1])[0]?.[0];

    const summary: TransactionsStatsSummaryDto = {
      total_sum_som: Math.round(totalSumSom),
      total_count: totalCount,
      top_currency_by_sum: topBySum,
      top_currency_by_count: topByCount,
      most_active_day: mostActiveDay,
      average_check_som: totalCount ? Math.round(totalSumSom / totalCount) : 0,
    };

    // table data reuse list()
    const table = await this.list({
      kind: query.kind,
      status: query.status,
      asset: query.asset,
      date_from: query.date_from,
      date_to: query.date_to,
      offset: query.offset,
      limit: query.limit,
    });

    return { series, summary, table };
  }

  async statsToday(): Promise<TransactionsStatsTodayDto> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();

    const baseWhere: Prisma.TransactionWhereInput = { createdAt: { gte: start, lte: end } };

    const totalSom = await this.prisma.transaction.aggregate({ _sum: { amount_in: true }, where: baseWhere });
    const bankToBank = await this.prisma.transaction.aggregate({ _sum: { amount_in: true }, where: { ...baseWhere, kind: 'BANK_TO_BANK' } });
    const walletToWallet = await this.prisma.transaction.aggregate({ _sum: { amount_in: true }, where: { ...baseWhere, kind: 'WALLET_TO_WALLET' } });
    const usersCount = await this.prisma.customer.count();

    return {
      total_amount_som: Number(totalSom._sum.amount_in ?? 0),
      bank_to_bank_som: Number(bankToBank._sum.amount_in ?? 0),
      wallet_to_wallet_som: Number(walletToWallet._sum.amount_in ?? 0),
      users_count: usersCount,
      date_from: start.toISOString(),
      date_to: end.toISOString(),
    };
  }
}
