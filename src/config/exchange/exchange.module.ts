import { Module } from '@nestjs/common';
import { ShkeeperExchangeService } from './shkeeper.service';
import { ShkeeperWalletService } from './shkeeper-wallet.service';

@Module({
  providers: [ShkeeperExchangeService, ShkeeperWalletService],
  exports: [ShkeeperExchangeService, ShkeeperWalletService],
})
export class ExchangeModule {}
