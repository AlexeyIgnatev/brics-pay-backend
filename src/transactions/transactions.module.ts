import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { PrismaClient } from '@prisma/client';
import { TransactionsService } from './transactions.service';
import { AdminManagementModule } from '../admin-management/admin-management.module';
import { SettingsModule } from '../config/settings/settings.module';
import { ExchangeModule } from '../config/exchange/exchange.module';

@Module({
  imports: [AdminManagementModule, SettingsModule, ExchangeModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, PrismaClient],
  exports: [TransactionsService],
})
export class TransactionsModule {}
