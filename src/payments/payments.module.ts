import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { BricsModule } from 'src/config/brics/brics.module';
import { EthereumModule } from 'src/config/ethereum/ethrereum.module';
import { PrismaClient } from '@prisma/client';
import { UsersModule } from '../users/users.module';
import { ConfigModule } from '@nestjs/config';
import { SettingsModule } from '../config/settings/settings.module';
import { ExchangeModule } from '../config/exchange/exchange.module';
import { UserManagementModule } from '../user-management/user-management.module';
import { AntiFraudModule } from '../antifraud/antifraud.module';
import { CryptoModule } from '../config/crypto/crypto.module';
import { UsdtTreasuryOrchestratorService } from './usdt-treasury-orchestrator.service';

@Module({
  imports: [
    EthereumModule,
    BricsModule,
    UsersModule,
    ConfigModule,
    SettingsModule,
    ExchangeModule,
    UserManagementModule,
    AntiFraudModule,
    CryptoModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, UsdtTreasuryOrchestratorService, PrismaClient],
})
export class PaymentsModule {}
