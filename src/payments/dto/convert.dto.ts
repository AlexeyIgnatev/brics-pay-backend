import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsNumber } from 'class-validator';
import { Currency } from '../../users/enums/currency';

export class ConvertDto {
  @ApiProperty({ enum: [Currency.SOM, Currency.ESOM, Currency.USDT_TRC20] })
  @IsIn([Currency.SOM, Currency.ESOM, Currency.USDT_TRC20])
  asset_from: Currency;

  @ApiProperty({ enum: [Currency.SOM, Currency.ESOM, Currency.USDT_TRC20] })
  @IsIn([Currency.SOM, Currency.ESOM, Currency.USDT_TRC20])
  asset_to: Currency;

  @ApiProperty({ description: 'Количество исходного актива' })
  @IsNumber()
  @IsNotEmpty()
  amount_from: number;
}
