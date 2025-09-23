import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaClient } from '@prisma/client';
import { BricsModule } from 'src/config/brics/brics.module';
import { EthereumModule } from 'src/config/ethereum/ethrereum.module';
import { BasicAuthGuard } from 'src/common/guards/basic-auth.guard';
import { CryptoModule } from '../config/crypto/crypto.module';
import { SettingsModule } from '../config/settings/settings.module';
import { ExchangeModule } from '../config/exchange/exchange.module';

@Module({
  imports: [BricsModule, EthereumModule, CryptoModule, SettingsModule, ExchangeModule],
  controllers: [UsersController],
  providers: [UsersService, PrismaClient, BasicAuthGuard],
  exports: [UsersService],
})
export class UsersModule {}
