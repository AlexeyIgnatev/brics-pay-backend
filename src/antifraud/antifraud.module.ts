import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AntiFraudService } from './antifraud.service';
import { AntiFraudController } from './antifraud.controller';
import { SettingsModule } from '../config/settings/settings.module';
import { ExchangeModule } from '../config/exchange/exchange.module';

@Module({
  imports: [SettingsModule, ExchangeModule],
  controllers: [AntiFraudController],
  providers: [AntiFraudService, PrismaClient],
  exports: [AntiFraudService],
})
export class AntiFraudModule {}
