import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient, TransactionStatus, WithdrawStatus } from '@prisma/client';
import { ShkeeperExchangeService } from '../config/exchange/shkeeper.service';

@Injectable()
export class ShkeeperPayoutSyncService {
  private readonly logger = new Logger(ShkeeperPayoutSyncService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly shkeeper: ShkeeperExchangeService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async syncSubmittedWithdrawals(): Promise<void> {
    const pending = await this.prisma.withdrawRequest.findMany({
      where: { status: WithdrawStatus.SUBMITTED, txid: { not: null } },
      orderBy: { updatedAt: 'asc' },
      take: 25,
    });

    for (const item of pending) {
      const taskId = item.txid;
      if (!taskId) continue;

      try {
        const task = await this.shkeeper.getPayoutTask(taskId);
        const status = String(task?.status ?? '').toUpperCase();
        if (status === 'PENDING') continue;

        const txHash = task?.result?.flatMap((r) => r.txids ?? []).find(Boolean) || item.txid;
        const finalStatus = status === 'SUCCESS' ? WithdrawStatus.SUCCESS : WithdrawStatus.FAILED;

        await this.prisma.withdrawRequest.update({
          where: { id: item.id },
          data: { status: finalStatus, txid: txHash },
        });

        const tx = await this.prisma.transaction.findFirst({
          where: {
            kind: 'WITHDRAW_CRYPTO',
            sender_customer_id: item.customer_id,
            asset_in: item.asset,
            amount_in: item.amount,
            tx_hash: taskId,
          },
          orderBy: { createdAt: 'desc' },
        });

        if (tx) {
          await this.prisma.transaction.update({
            where: { id: tx.id },
            data: {
              status: finalStatus === WithdrawStatus.SUCCESS ? TransactionStatus.SUCCESS : TransactionStatus.FAILED,
              tx_hash: txHash,
            },
          });
        }
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        this.logger.warn(`SHKeeper payout sync failed for withdraw ${item.id}: ${details}`);
      }
    }
  }
}
