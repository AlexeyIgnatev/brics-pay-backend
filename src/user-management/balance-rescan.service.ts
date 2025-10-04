import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BalanceFetchService } from './balance-fetch.service';

@Injectable()
export class BalanceRescanService {
  private readonly logger = new Logger(BalanceRescanService.name);
  constructor(
    private readonly prisma: PrismaClient,
    private readonly fetcher: BalanceFetchService,
  ) {}

  // For backward compatibility: now just delegates to a single source of truth
  async rescanUserEsom(customer_id: number, _address?: string) {
    try {
      await this.fetcher.refreshAllBalancesForUser(customer_id);
    } catch (e) {
      this.logger.error(`Rescan failed for user ${customer_id}: ${e}`);
    }
  }

  async triggerForUsers(senderId?: number | null, receiverId?: number | null) {
    if (senderId) await this.rescanUserEsom(senderId);
    if (receiverId && receiverId !== senderId) await this.rescanUserEsom(receiverId);
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async dailyRescan() {
    this.logger.log('Starting daily balances rescan (ESOM, ETH, BTC, USDT_TRC20)');
    const customers = await this.prisma.customer.findMany({ select: { customer_id: true } });
    for (const c of customers) {
      await this.fetcher.refreshAllBalancesForUser(c.customer_id);
    }
    this.logger.log('Daily balances rescan finished');
  }
}
