import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../../users/enums/currency';

function emptyStringToUndefined({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export class PaymentDto {
  @ApiProperty({ description: 'Payment amount' })
  @IsNumber()
  @IsNotEmpty()
  amount: number;
}

export class TransferDto {
  @ApiProperty({ description: 'Transfer amount' })
  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @ApiProperty({ description: 'Recipient phone number', required: false })
  @IsString()
  @IsOptional()
  @Transform(emptyStringToUndefined)
  phone_number?: string;

  @ApiProperty({ description: 'Crypto wallet address', required: false })
  @IsString()
  @IsOptional()
  @Transform(emptyStringToUndefined)
  address?: string;

  @ApiProperty({ enum: [Currency.SOM, Currency.ESOM, Currency.USDT_TRC20] })
  @IsEnum(Currency)
  currency: Currency;
}
