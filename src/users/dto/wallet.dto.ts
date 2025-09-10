import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../enums/currency';

export class WalletDto {
  @ApiProperty({ enum: Currency })
  currency: Currency;

  address: string;

  balance: number;

  buy_rate: number;

  sell_rate: number;
}