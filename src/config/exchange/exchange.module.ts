import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ShkeeperExchangeService } from './shkeeper.service';
import { ShkeeperWalletService } from './shkeeper-wallet.service';

@Module({
  providers: [PrismaClient, ShkeeperExchangeService, ShkeeperWalletService],
  exports: [ShkeeperExchangeService, ShkeeperWalletService],
})
export class ExchangeModule {}
