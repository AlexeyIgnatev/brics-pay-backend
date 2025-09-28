import { Module } from '@nestjs/common';
import { UserManagementController } from './user-management.controller';
import { UserManagementService } from './user-management.service';
import { PrismaClient } from '@prisma/client';
import { AdminManagementModule } from '../admin-management/admin-management.module';
import { ExchangeModule } from '../config/exchange/exchange.module';
import { EthereumModule } from '../config/ethereum/ethrereum.module';
import { ScheduleModule } from '@nestjs/schedule';
import { PriceCacheService } from './price-cache.service';
import { BalanceRescanService } from './balance-rescan.service';

@Module({
  imports: [AdminManagementModule, ExchangeModule, EthereumModule, ScheduleModule.forRoot()],
  controllers: [UserManagementController],
  providers: [UserManagementService, PrismaClient, PriceCacheService, BalanceRescanService],
  exports: [BalanceRescanService],
})
export class UserManagementModule {}
