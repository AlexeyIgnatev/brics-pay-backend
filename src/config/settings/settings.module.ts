import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { PrismaClient } from '@prisma/client';
import { BricsModule } from '../brics/brics.module';
import { EthereumModule } from '../ethereum/ethrereum.module';
import { CryptoModule } from '../crypto/crypto.module';

@Module({
  imports: [BricsModule, EthereumModule, CryptoModule],
  providers: [SettingsService, PrismaClient],
  exports: [SettingsService],
})
export class SettingsModule {}
