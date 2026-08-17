import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsNumber } from 'class-validator';
import { Currency } from '../../users/enums/currency';

export class ConvertDto {
  @ApiProperty({ enum: [Currency.SOM, Currency.ESOM, Currency.USDT_TRC20] })
  @IsIn([Currency.SOM, Currency.ESOM, Currency.USDT_TRC20], {
    message: 'Выберите исходную валюту',
  })
  asset_from: Currency;

  @ApiProperty({ enum: [Currency.SOM, Currency.ESOM, Currency.USDT_TRC20] })
  @IsIn([Currency.SOM, Currency.ESOM, Currency.USDT_TRC20], {
    message: 'Выберите валюту получения',
  })
  asset_to: Currency;

  @ApiProperty({ description: 'Количество исходного актива' })
  @IsNumber({}, { message: 'Сумма должна быть числом' })
  @IsNotEmpty({ message: 'Укажите сумму конвертации' })
  amount_from: number;
}
