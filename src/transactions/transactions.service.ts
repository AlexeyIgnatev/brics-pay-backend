import { Injectable } from '@nestjs/common';
import {
  AccountingPosting,
  Asset,
  CustomerResidency,
  BlockchainTransaction,
  Prisma,
  PrismaClient,
  TariffCategory,
  TariffOperation,
  TransactionKind,
  TransactionStatus,
} from '@prisma/client';
import {
  TransactionsListDto,
  TransactionsListResponseDto,
} from './dto/transactions-list.dto';
import {
  TransactionsStatsQueryDto,
  TransactionsStatsResponseDto,
  TransactionsStatsSeriesPointDto,
  TransactionsStatsSummaryDto,
  TransactionsStatsTodayDto,
} from './dto/transactions-stats.dto';
import { SettingsService } from '../config/settings/settings.service';

const ALLOWED_ASSETS = ['SOM', 'ESOM', 'USDT_TRC20'] as const;
const BRICS_BURN_DEBIT_ACCOUNT = '92602';
const BRICS_BURN_CREDIT_ACCOUNT = '90001';
const TRON_SUN = 1_000_000;

type CustomerBrief = {
  customer_id: number;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  tariff_category?: TariffCategory;
  residency?: CustomerResidency;
};

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: SettingsService,
  ) {}

  private parseNetworkFee(
    tx: Pick<BlockchainTransaction, 'fee_amount_raw' | 'fee_asset'> | undefined,
  ): { amount?: number; asset?: string } {
    if (!tx) {
      return {};
    }

    if (!tx.fee_amount_raw) {
      return { amount: 0, asset: tx.fee_asset ?? 'TRX' };
    }

    const raw = Number(tx.fee_amount_raw);
    if (!Number.isFinite(raw) || raw <= 0) {
      return { amount: 0, asset: tx.fee_asset ?? 'TRX' };
    }

    if (tx.fee_asset === 'TRX') {
      return { amount: raw / TRON_SUN, asset: tx.fee_asset };
    }

    return {
      amount: raw,
      asset: tx.fee_asset ?? undefined,
    };
  }

  private getBricsBurnedAmount(
    postings: Pick<
      AccountingPosting,
      'amount' | 'debit_account_no' | 'credit_account_no'
    >[],
  ): number | undefined {
    const burnedAmount = postings
      .filter(
        (posting) =>
          posting.debit_account_no === BRICS_BURN_DEBIT_ACCOUNT &&
          posting.credit_account_no === BRICS_BURN_CREDIT_ACCOUNT,
      )
      .reduce((sum, posting) => sum + Number(posting.amount), 0);

    return burnedAmount > 0 ? burnedAmount : undefined;
  }

  private async resolveCustomerBriefByWalletAddress(
    address?: string | null,
  ): Promise<CustomerBrief | null> {
    const normalized = address?.trim();
    if (!normalized) return null;

    const customer = await this.prisma.customer.findFirst({
      where: { address: normalized },
      select: {
        customer_id: true,
        first_name: true,
        middle_name: true,
        last_name: true,
        phone: true,
        email: true,
        tariff_category: true,
        residency: true,
      },
    });

    if (!customer) return null;

    return {
      customer_id: customer.customer_id,
      first_name: customer.first_name ?? undefined,
      middle_name: customer.middle_name ?? undefined,
      last_name: customer.last_name ?? undefined,
      phone: customer.phone ?? undefined,
      email: customer.email ?? undefined,
      tariff_category: customer.tariff_category,
      residency: customer.residency,
    };
  }

  private tariffOperationForTransaction(item: {
    kind: TransactionKind;
    asset_in: Asset | null;
    asset_out: Asset | null;
  }): TariffOperation | null {
    const from = item.asset_in;
    const to = item.asset_out;
    const key = `${from}_TO_${to}`;
    switch (key) {
      case 'SOM_TO_ESOM':
        return TariffOperation.SOM_TO_ESOM;
      case 'ESOM_TO_SOM':
        return TariffOperation.ESOM_TO_SOM;
      case 'ESOM_TO_USDT_TRC20':
        return TariffOperation.ESOM_TO_USDT_TRC20;
      case 'USDT_TRC20_TO_ESOM':
        return TariffOperation.USDT_TRC20_TO_ESOM;
      case 'ESOM_TO_ESOM':
      case 'USDT_TRC20_TO_USDT_TRC20':
      case 'SOM_TO_SOM':
        return item.kind === TransactionKind.WALLET_TO_WALLET
          ? from === 'ESOM'
            ? TariffOperation.WALLET_TRANSFER_ESOM
            : from === 'USDT_TRC20'
              ? TariffOperation.WALLET_TRANSFER_USDT_TRC20
              : null
          : null;
      default:
        return item.kind === TransactionKind.WALLET_TO_WALLET
          ? from === 'ESOM'
            ? TariffOperation.WALLET_TRANSFER_ESOM
            : from === 'USDT_TRC20'
              ? TariffOperation.WALLET_TRANSFER_USDT_TRC20
              : null
          : null;
    }
  }

  private async resolveFeeAmountFromTariffs(item: {
    kind: TransactionKind;
    fee_amount: Prisma.Decimal | string | number | null;
    amount_in: Prisma.Decimal | string | number;
    asset_in: Asset;
    asset_out: Asset;
    sender_customer?: {
      tariff_category: TariffCategory;
      residency: CustomerResidency;
    } | null;
  }): Promise<number> {
    const existingFee = Number(item.fee_amount ?? 0);
    if (existingFee > 0) return existingFee;

    const operation = this.tariffOperationForTransaction(item);
    if (!operation) return 0;

    const customer = item.sender_customer;
    if (!customer) return 0;

    const tariff = await this.prisma.tariffSetting.findUnique({
      where: {
        category_residency_operation: {
          category: customer.tariff_category,
          residency: customer.residency,
          operation,
        },
      },
      select: { percent_fee: true, fixed_fee: true },
    });

    if (!tariff) return 0;

    const percent = Number(tariff.percent_fee ?? 0);
    const fixed = Number(tariff.fixed_fee ?? 0);
    const safePercent = Number.isFinite(percent) && percent > 0 ? percent : 0;
    const safeFixed = Number.isFinite(fixed) && fixed > 0 ? fixed : 0;
    return Number(item.amount_in ?? 0) * (safePercent / 100) + safeFixed;
  }

  async list(query: TransactionsListDto): Promise<TransactionsListResponseDto> {
    const where: Prisma.TransactionWhereInput = {};

    if (query.kind?.length) {
      where.kind = { in: query.kind as TransactionKind[] };
    }
    if (query.status?.length) {
      where.status = { in: query.status as TransactionStatus[] };
    }
    if (query.asset?.length) {
      const requestedAssets = (query.asset as Asset[]).filter((asset) =>
        ALLOWED_ASSETS.includes(asset as (typeof ALLOWED_ASSETS)[number]),
      );
      where.OR = requestedAssets.length
        ? [{ asset_in: { in: requestedAssets } }]
        : [{ id: -1 }];
    }
    if (query.tx_hash) {
      where.tx_hash = { contains: query.tx_hash };
    }
    if (query.id) {
      where.bank_op_id = query.id;
    }
    if (query.amount_min != null || query.amount_max != null) {
      where.amount_in = {} as { gte?: string; lte?: string };
      if (query.amount_min != null) {
        (where.amount_in as { gte?: string }).gte = query.amount_min.toString();
      }
      if (query.amount_max != null) {
        (where.amount_in as { lte?: string }).lte = query.amount_max.toString();
      }
    }
    if (query.date_from || query.date_to) {
      where.createdAt = {} as { gte?: Date; lte?: Date };
      if (query.date_from) {
        (where.createdAt as { gte?: Date }).gte = new Date(query.date_from);
      }
      if (query.date_to) {
        (where.createdAt as { lte?: Date }).lte = new Date(query.date_to);
      }
    }

    if (query.sender) {
      where.OR = where.OR || [];
      (where.OR as Prisma.TransactionWhereInput[]).push(
        {
          sender_wallet_address: {
            contains: query.sender,
            mode: 'insensitive',
          },
        },
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
      where.OR = where.OR || [];
      (where.OR as Prisma.TransactionWhereInput[]).push(
        {
          receiver_wallet_address: {
            contains: query.receiver,
            mode: 'insensitive',
          },
        },
        {
          external_address: {
            contains: query.receiver,
            mode: 'insensitive',
          },
        },
        {
          receiver_customer: {
            OR: [
              { first_name: { contains: query.receiver, mode: 'insensitive' } },
              {
                middle_name: { contains: query.receiver, mode: 'insensitive' },
              },
              { last_name: { contains: query.receiver, mode: 'insensitive' } },
              { phone: { contains: query.receiver, mode: 'insensitive' } },
              { email: { contains: query.receiver, mode: 'insensitive' } },
            ],
          },
        },
      );
    }

    const orderBy: Prisma.TransactionOrderByWithRelationInput = {};
    const sortBy =
      (query.sort_by === 'amount' ? 'amount_in' : query.sort_by) ?? 'createdAt';
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
        },
      }),
    ]);

    const filteredItems = itemsRaw.filter((item) =>
      ALLOWED_ASSETS.includes(item.asset_in as (typeof ALLOWED_ASSETS)[number]),
    );
    const txHashes = Array.from(
      new Set(filteredItems.map((item) => item.tx_hash).filter(Boolean)),
    ) as string[];
    const transactionIds = filteredItems.map((item) => item.id);

    const [blockchainTransactions, accountingPostings] = await Promise.all([
      txHashes.length
        ? this.prisma.blockchainTransaction.findMany({
            where: { tx_hash: { in: txHashes } },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          })
        : Promise.resolve([]),
      transactionIds.length
        ? this.prisma.accountingPosting.findMany({
            where: { transaction_id: { in: transactionIds } },
            select: {
              transaction_id: true,
              amount: true,
              debit_account_no: true,
              credit_account_no: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const blockchainByHash = new Map<
      string,
      Pick<
        BlockchainTransaction,
        'fee_amount_raw' | 'fee_asset' | 'energy_used' | 'bandwidth_used'
      >
    >();
    for (const blockchainTransaction of blockchainTransactions) {
      if (
        blockchainTransaction.tx_hash &&
        !blockchainByHash.has(blockchainTransaction.tx_hash)
      ) {
        blockchainByHash.set(
          blockchainTransaction.tx_hash,
          blockchainTransaction,
        );
      }
    }

    const postingsByTransactionId = new Map<
      number,
      Pick<
        AccountingPosting,
        'amount' | 'debit_account_no' | 'credit_account_no'
      >[]
    >();
    for (const posting of accountingPostings) {
      if (!posting.transaction_id) {
        continue;
      }
      const bucket = postingsByTransactionId.get(posting.transaction_id) ?? [];
      bucket.push(posting);
      postingsByTransactionId.set(posting.transaction_id, bucket);
    }

    const items = await Promise.all(
      filteredItems.map(async (item) => {
        const blockchainTransaction = item.tx_hash
          ? blockchainByHash.get(item.tx_hash)
          : undefined;
        const networkFee = this.parseNetworkFee(blockchainTransaction);
        const resolvedSenderCustomer =
          item.sender_customer ??
          (await this.resolveCustomerBriefByWalletAddress(
            item.sender_wallet_address,
          ));
        const feeAmount = await this.resolveFeeAmountFromTariffs({
          kind: item.kind,
          fee_amount: item.fee_amount,
          amount_in: item.amount_in,
          asset_in: item.asset_in as Asset,
          asset_out: item.asset_out as Asset,
          sender_customer:
            resolvedSenderCustomer?.tariff_category &&
            resolvedSenderCustomer?.residency
              ? {
                  tariff_category: resolvedSenderCustomer.tariff_category,
                  residency: resolvedSenderCustomer.residency,
                }
              : null,
        });
        const resolvedReceiverCustomer =
          item.receiver_customer ??
          (await this.resolveCustomerBriefByWalletAddress(
            item.receiver_wallet_address,
          ));

        return {
          id: item.id,
          kind: item.kind as unknown as string,
          status: item.status as unknown as string,
          amount: Number(item.amount_in),
          fee_amount: feeAmount,
          asset: item.asset_in as unknown as string,
          tx_hash: item.tx_hash ?? undefined,
          bank_op_id: item.bank_op_id ?? undefined,
          sender_customer_id: item.sender_customer_id ?? undefined,
          receiver_customer_id: item.receiver_customer_id ?? undefined,
          sender_abs_id: item.sender_customer_id ?? undefined,
          receiver_abs_id: item.receiver_customer_id ?? undefined,
          client_abs_id:
            item.sender_customer_id ?? item.receiver_customer_id ?? undefined,
          sender_wallet_address: item.sender_wallet_address ?? undefined,
          receiver_wallet_address: item.receiver_wallet_address ?? undefined,
          external_address: item.external_address ?? undefined,
          comment: item.comment ?? undefined,
          network_fee_amount: networkFee.amount,
          network_fee_asset: networkFee.asset,
          energy_used:
            blockchainTransaction != null
              ? (blockchainTransaction.energy_used ?? 0)
              : undefined,
          bandwidth_used:
            blockchainTransaction != null
              ? (blockchainTransaction.bandwidth_used ?? 0)
              : undefined,
          brics_burned_amount:
            this.getBricsBurnedAmount(
              postingsByTransactionId.get(item.id) ?? [],
            ) ?? 0,
          createdAt: item.createdAt,
          sender_customer: resolvedSenderCustomer
            ? {
                customer_id: resolvedSenderCustomer.customer_id,
                first_name: resolvedSenderCustomer.first_name ?? undefined,
                middle_name: resolvedSenderCustomer.middle_name ?? undefined,
                last_name: resolvedSenderCustomer.last_name ?? undefined,
                phone: resolvedSenderCustomer.phone ?? undefined,
                email: resolvedSenderCustomer.email ?? undefined,
              }
            : undefined,
          receiver_customer: resolvedReceiverCustomer
            ? {
                customer_id: resolvedReceiverCustomer.customer_id,
                first_name: resolvedReceiverCustomer.first_name ?? undefined,
                middle_name: resolvedReceiverCustomer.middle_name ?? undefined,
                last_name: resolvedReceiverCustomer.last_name ?? undefined,
                phone: resolvedReceiverCustomer.phone ?? undefined,
                email: resolvedReceiverCustomer.email ?? undefined,
              }
            : undefined,
        };
      }),
    );

    return {
      total,
      items,
      offset: query.offset ?? 0,
      limit: query.limit ?? 20,
    };
  }

  async stats(
    query: TransactionsStatsQueryDto,
  ): Promise<TransactionsStatsResponseDto> {
    const where: Prisma.TransactionWhereInput = {};
    if (query.kind?.length)
      where.kind = { in: query.kind as TransactionKind[] };
    if (query.status?.length)
      where.status = { in: query.status as TransactionStatus[] };
    if (query.asset?.length) {
      const requestedAssets = (query.asset as Asset[]).filter((asset) =>
        ALLOWED_ASSETS.includes(asset as (typeof ALLOWED_ASSETS)[number]),
      );
      where.OR = requestedAssets.length
        ? [{ asset_in: { in: requestedAssets } }]
        : [{ id: -1 }];
    }
    if (query.date_from || query.date_to) {
      where.createdAt = {} as { gte?: Date; lte?: Date };
      if (query.date_from)
        (where.createdAt as { gte?: Date }).gte = new Date(query.date_from);
      if (query.date_to)
        (where.createdAt as { lte?: Date }).lte = new Date(query.date_to);
    }

    const txs = await this.prisma.transaction.findMany({
      where,
      select: { id: true, createdAt: true, amount_in: true, asset_in: true },
      orderBy: { createdAt: 'asc' },
    });

    const esomPerUsd = Number((await this.settings.get()).esom_per_usd);
    const toSom = (asset: Asset, amount: string | number): number => {
      const amt = Number(amount || 0);
      if (!amt) return 0;
      if (asset === 'SOM' || asset === 'ESOM') return amt;
      if (asset === 'USDT_TRC20') return amt * esomPerUsd;
      return 0;
    };

    const keyFor = (d: Date): string => {
      const dt = new Date(d);
      if (query.group_by === 'month') {
        dt.setDate(1);
        dt.setHours(0, 0, 0, 0);
      } else if (query.group_by === 'week') {
        const day = dt.getDay();
        const diff = (day + 6) % 7;
        dt.setDate(dt.getDate() - diff);
        dt.setHours(0, 0, 0, 0);
      } else {
        dt.setHours(0, 0, 0, 0);
      }
      return dt.toISOString();
    };

    const seriesMap = new Map<string, { sum: number; count: number }>();
    const perCurrencySum = new Map<string, number>();
    const perCurrencyCount = new Map<string, number>();

    let totalSumSom = 0;
    for (const t of txs) {
      if (
        !ALLOWED_ASSETS.includes(t.asset_in as (typeof ALLOWED_ASSETS)[number])
      ) {
        continue;
      }
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

    const series: TransactionsStatsSeriesPointDto[] = Array.from(
      seriesMap.entries(),
    )
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({
        date,
        value: query.metric === 'count' ? v.count : v.sum,
      }));

    const totalCount = txs.length;
    const topBySum = Array.from(perCurrencySum.entries()).sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0];
    const topByCount = Array.from(perCurrencyCount.entries()).sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0];

    const dayCounts = new Map<string, number>();
    for (const t of txs) {
      const dayKey = keyFor(
        t.createdAt instanceof Date ? t.createdAt : new Date(t.createdAt),
      );
      dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
    }
    const mostActiveDay = Array.from(dayCounts.entries()).sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0];

    const summary: TransactionsStatsSummaryDto = {
      total_sum_som: Math.round(totalSumSom),
      total_count: totalCount,
      top_currency_by_sum: topBySum,
      top_currency_by_count: topByCount,
      most_active_day: mostActiveDay,
      average_check_som: totalCount ? Math.round(totalSumSom / totalCount) : 0,
    };

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

    const baseWhere: Prisma.TransactionWhereInput = {
      createdAt: { gte: start, lte: end },
    };

    const totalSom = await this.prisma.transaction.aggregate({
      _sum: { amount_in: true },
      where: baseWhere,
    });
    const bankToBank = await this.prisma.transaction.aggregate({
      _sum: { amount_in: true },
      where: { ...baseWhere, kind: 'BANK_TO_BANK' },
    });
    const walletToWallet = await this.prisma.transaction.aggregate({
      _sum: { amount_in: true },
      where: { ...baseWhere, kind: 'WALLET_TO_WALLET' },
    });
    const usersCount = await this.prisma.customer.count();
    const successfulCount = await this.prisma.transaction.count({
      where: { ...baseWhere, status: 'SUCCESS' },
    });

    return {
      total_amount_som: Number(totalSom._sum.amount_in ?? 0),
      bank_to_bank_som: Number(bankToBank._sum.amount_in ?? 0),
      wallet_to_wallet_som: Number(walletToWallet._sum.amount_in ?? 0),
      users_count: usersCount,
      successful_count: successfulCount,
      date_from: start.toISOString(),
      date_to: end.toISOString(),
    };
  }
}
