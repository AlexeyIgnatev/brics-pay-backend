import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { PrismaClient } from '@prisma/client';
import { TransactionsService } from './transactions.service';
import { AdminManagementModule } from '../admin-management/admin-management.module';
import { SettingsModule } from '../config/settings/settings.module';
import { ExchangeModule } from '../config/exchange/exchange.module';
import { CryptoModule } from '../config/crypto/crypto.module';

@Module({
  imports: [
    AdminManagementModule,
    SettingsModule,
    ExchangeModule,
    CryptoModule,
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService, PrismaClient],
  exports: [TransactionsService],
})
export class TransactionsModule {}
