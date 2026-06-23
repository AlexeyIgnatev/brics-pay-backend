import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../../users/enums/currency';

export class UsdtFeeQuoteDto {
  @ApiProperty({ enum: [Currency.USDT_TRC20] })
  currency: Currency.USDT_TRC20;

  @ApiProperty({ description: 'Requested transfer amount' })
  amount: number;

  @ApiProperty({ description: 'Fee percent from tariff table' })
  percent_fee: number;

  @ApiProperty({ description: 'Fixed fee from tariff table' })
  fixed_fee: number;

  @ApiProperty({ description: 'Calculated fee for this user and amount' })
  fee: number;

  @ApiProperty({ description: 'Amount after fee is deducted from the transfer amount' })
  net_amount: number;
}
