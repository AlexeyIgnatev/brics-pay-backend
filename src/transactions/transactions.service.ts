import { Injectable } from '@nestjs/common';
import { Asset, Prisma, PrismaClient } from '@prisma/client';
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

    if (query.kind?.length) where.kind = { in: query.kind as any };
    if (query.status?.length) where.status = { in: query.status as any };
    if (query.asset?.length) where.OR = [
      { asset_out: { in: query.asset as any } },
      { asset_in: { in: query.asset as any } },
    ];
    if (query.tx_hash) where.tx_hash = { contains: query.tx_hash };
    if (query.id) where.bank_op_id = query.id;
    if (query.amount_min != null || query.amount_max != null) {
      where.amount_out = {} as any;
      if (query.amount_min != null) (where.amount_out as any).gte = query.amount_min.toString();
      if (query.amount_max != null) (where.amount_out as any).lte = query.amount_max.toString();
    }
    if (query.date_from || query.date_to) {
      where.createdAt = {} as any;
      if (query.date_from) (where.createdAt as any).gte = new Date(query.date_from);
      if (query.date_to) (where.createdAt as any).lte = new Date(query.date_to);
    }

    if (query.sender) {
      where.OR = where.OR || [];
      (where.OR as any[]).push(
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
      (where.OR as any[]).push(
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
    const sortBy = (query.sort_by === 'amount' ? 'amount_out' : query.sort_by) ?? 'createdAt';
    const sortDir = query.sort_dir ?? 'desc';
    (orderBy as any)[sortBy] = sortDir;

    const [total, items] = await this.prisma.$transaction([
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

    return { total, items, offset: query.offset ?? 0, limit: query.limit ?? 20 } as any;
  }

  async stats(query: TransactionsStatsQueryDto): Promise<TransactionsStatsResponseDto> {
    const where: Prisma.TransactionWhereInput = {};
    if (query.kind?.length) where.kind = { in: query.kind as any };
    if (query.status?.length) where.status = { in: query.status as any };
    if (query.asset?.length) where.OR = [
      { asset_out: { in: query.asset as any } },
      { asset_in: { in: query.asset as any } },
    ];
    if (query.date_from || query.date_to) {
      where.createdAt = {} as any;
      if (query.date_from) (where.createdAt as any).gte = new Date(query.date_from);
      if (query.date_to) (where.createdAt as any).lte = new Date(query.date_to);
    }

    const txs = await this.prisma.transaction.findMany({
      where,
      select: { id: true, createdAt: true, amount_out: true, asset_out: true },
      orderBy: { createdAt: 'asc' },
    });

    // prices for crypto now
    const prices = await this.exchange.getUsdPrices(['BTC', 'ETH', 'USDT_TRC20'] as unknown as Asset[]);
    const esomPerUsd = Number((await this.settings.get()).esom_per_usd);
    const toSom = (asset: Asset, amountStr: any): number => {
      const amount = Number(amountStr || 0);
      if (!amount) return 0;
      if (asset === 'SOM' || asset === 'ESOM') return amount;
      const usd = amount * Number(prices[asset] ?? 0);
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
      const som = toSom(t.asset_out as Asset, t.amount_out as any);
      totalSumSom += som;
      const k = keyFor(t.createdAt);
      const cur = seriesMap.get(k) || { sum: 0, count: 0 };
      cur.sum += som;
      cur.count += 1;
      seriesMap.set(k, cur);

      const a = t.asset_out as string;
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
    } as any);

    return { series, summary, table };
  }

  async statsToday(): Promise<TransactionsStatsTodayDto> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();

    const baseWhere: Prisma.TransactionWhereInput = { createdAt: { gte: start, lte: end } };

    const totalSom = await this.prisma.transaction.aggregate({ _sum: { amount_out: true }, where: baseWhere });
    const bankToBank = await this.prisma.transaction.aggregate({ _sum: { amount_out: true }, where: { ...baseWhere, kind: 'BANK_TO_BANK' as any } });
    const walletToWallet = await this.prisma.transaction.aggregate({ _sum: { amount_out: true }, where: { ...baseWhere, kind: 'WALLET_TO_WALLET' as any } });
    const usersCount = await this.prisma.customer.count();

    return {
      total_amount_som: (totalSom._sum.amount_out as any) ?? 0,
      bank_to_bank_som: (bankToBank._sum.amount_out as any) ?? 0,
      wallet_to_wallet_som: (walletToWallet._sum.amount_out as any) ?? 0,
      users_count: usersCount,
      date_from: start.toISOString(),
      date_to: end.toISOString(),
    };
  }
}
