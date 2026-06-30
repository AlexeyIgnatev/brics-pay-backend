import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString } from 'class-validator';

function emptyStringToUndefined({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export class UsdtDepositWebhookDto {
  @ApiProperty({ description: 'Blockchain transaction hash' })
  @IsString()
  tx_hash: string;

  @ApiProperty({ description: 'Sender address' })
  @IsString()
  from_address: string;

  @ApiProperty({ description: 'Receiver address' })
  @IsString()
  to_address: string;

  @ApiProperty({ description: 'USDT amount' })
  @IsNumber()
  amount: number;

  @ApiPropertyOptional({ description: 'Optional idempotency key for retries' })
  @IsOptional()
  @IsString()
  @Transform(emptyStringToUndefined)
  idempotency_key?: string;

  @ApiPropertyOptional({ description: 'Optional raw provider payload' })
  @IsOptional()
  payload?: Record<string, unknown>;
}
