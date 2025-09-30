import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, Asset } from '@prisma/client';
import { EthereumService } from '../config/ethereum/ethereum.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BalanceFetchService } from './balance-fetch.service';

@Injectable()
export class BalanceRescanService {
  private readonly logger = new Logger(BalanceRescanService.name);
  constructor(
    private readonly prisma: PrismaClient,
    private readonly eth: EthereumService,
    private readonly fetcher: BalanceFetchService,
  ) {}

  async rescanUserEsom(customer_id: number, address?: string) {
    try {
      const customer = address
        ? { customer_id, address }
        : await this.prisma.customer.findUnique({ where: { customer_id }, select: { address: true, customer_id: true } });
      if (!customer?.address) return;
      const esom = await this.eth.getEsomBalance(customer.address);
      await this.prisma.userAssetBalance.upsert({
        where: { customer_id_asset: { customer_id, asset: 'ESOM' as Asset } },
        create: { customer_id, asset: 'ESOM' as Asset, balance: esom.toString() },
        update: { balance: esom.toString() },
      });

      // also refresh other crypto balances to keep cache fresh
      await this.fetcher.refreshAllBalancesForUser(customer_id);
    } catch (e) {
      this.logger.error(`Rescan ESOM failed for user ${customer_id}: ${e}`);
    }
  }

  async triggerForUsers(senderId?: number | null, receiverId?: number | null) {
    if (senderId) await this.rescanUserEsom(senderId);
    if (receiverId && receiverId !== senderId) await this.rescanUserEsom(receiverId);
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async dailyRescan() {
    this.logger.log('Starting daily balances rescan (ESOM, ETH, BTC, USDT_TRC20)');
    const customers = await this.prisma.customer.findMany({ select: { customer_id: true, address: true } });
    for (const c of customers) {
      await this.rescanUserEsom(c.customer_id, c.address);
      await this.fetcher.refreshAllBalancesForUser(c.customer_id);
    }
    this.logger.log('Daily balances rescan finished');
  }
}
