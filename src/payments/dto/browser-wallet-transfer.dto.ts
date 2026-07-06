import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Currency } from '../../users/enums/currency';

function emptyStringToUndefined({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export class BrowserWalletTransferDto {
  @ApiProperty({ example: 910000001 })
  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  customer_id: number;

  @ApiProperty({ example: 'TRVh3EuuWTkCfECfXM77SGZZZQwJT49WBm' })
  @IsString()
  @IsNotEmpty()
  @Transform(emptyStringToUndefined)
  address: string;

  @ApiProperty({ example: 10 })
  @IsNumber()
  @IsNotEmpty()
  @Min(0.000001)
  amount: number;

  @ApiProperty({ enum: [Currency.USDT_TRC20], default: Currency.USDT_TRC20 })
  @IsIn([Currency.USDT_TRC20])
  currency: Currency.USDT_TRC20 = Currency.USDT_TRC20;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @Transform(emptyStringToUndefined)
  idempotency_key?: string;
}
