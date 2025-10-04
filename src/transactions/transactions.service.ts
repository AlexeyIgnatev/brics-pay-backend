import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TransactionsListDto, TransactionsListResponseDto } from './dto/transactions-list.dto';
import { TransactionsStatsTodayDto } from './dto/transactions-stats.dto';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaClient) {}

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
