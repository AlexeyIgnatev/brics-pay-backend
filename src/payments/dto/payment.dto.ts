import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../../users/enums/currency';

export class PaymentDto {
  @ApiProperty({ description: 'Сумма платежа' })
  @IsNumber()
  @IsNotEmpty()
  amount: number;
}

export class TransferDto {
  @ApiProperty({ description: 'Сумма платежа' })
  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @ApiProperty({ description: 'Номер телефона получателя' })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  phone_number?: string;

  @ApiProperty({ description: 'Адрес крипто кошелька' })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  address?: string;

  @ApiProperty({ enum: Currency })
  @IsEnum(Currency)
  currency: Currency;
}
