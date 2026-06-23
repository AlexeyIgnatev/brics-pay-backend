import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../enums/currency';

export class WalletDto {
  @ApiProperty({ enum: [Currency.SOM, Currency.ESOM, Currency.USDT_TRC20] })
  currency: Currency;

  address: string;

  balance: number;

  buy_rate: number;

  sell_rate: number;
}
