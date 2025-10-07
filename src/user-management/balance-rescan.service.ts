import { Injectable, Logger } from '@nestjs/common';
import { Asset, PrismaClient } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BalanceFetchService } from './balance-fetch.service';

@Injectable()
export class BalanceRescanService {
  private readonly logger = new Logger(BalanceRescanService.name);
  constructor(
    private readonly prisma: PrismaClient,
    private readonly fetcher: BalanceFetchService,
  ) {}


  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async dailyRescan() {
    this.logger.log('Starting daily balances rescan (ESOM, ETH, BTC, USDT_TRC20)');
    const customers = await this.prisma.customer.findMany({ select: { customer_id: true } });
    for (const c of customers) {
      await this.fetcher.refreshAllBalancesForUser(c.customer_id, ['ESOM' as Asset]);
    }
    this.logger.log('Daily balances rescan finished');
  }
}
