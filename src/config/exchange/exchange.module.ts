import { Module } from '@nestjs/common';
import { BybitExchangeService } from './bybit.service';

@Module({
  providers: [BybitExchangeService],
  exports: [BybitExchangeService],
})
export class ExchangeModule {}
