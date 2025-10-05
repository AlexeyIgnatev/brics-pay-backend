import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumberString, IsOptional, IsString, Min } from 'class-validator';
import { AntiFraudCaseStatus, AntiFraudRuleKey, Asset, TransactionKind, TransactionStatus } from '@prisma/client';

export class UpdateRuleDto {
  @ApiPropertyOptional({ description: 'Включено ли правило', example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Период (дней), используется для правил с историей операций', example: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  period_days?: number | null;

  @ApiPropertyOptional({ description: 'Порог в СОМ (decimal string)', example: '1000000' })
  @IsOptional()
  @IsNumberString()
  threshold_som?: string | null;

  @ApiPropertyOptional({ description: 'Минимальное количество событий (для частотных правил)', example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  min_count?: number | null;

  @ApiPropertyOptional({ description: 'Порог в процентах (0-100) как decimal string', example: '50' })
  @IsOptional()
  @IsNumberString()
  percent_threshold?: string | null;
}

export class AntiFraudRuleDto {
  @ApiProperty({ example: 1 }) id!: number;
  @ApiProperty({ enum: AntiFraudRuleKey }) key!: AntiFraudRuleKey;
  @ApiProperty({ example: true }) enabled!: boolean;
  @ApiPropertyOptional({ example: 30 }) period_days?: number | null;
  @ApiPropertyOptional({ description: 'Порог в СОМ', example: '1000000' }) threshold_som?: string | null;
  @ApiPropertyOptional({ example: 3 }) min_count?: number | null;
  @ApiPropertyOptional({ description: 'Порог в процентах', example: '50' }) percent_threshold?: string | null;
  @ApiProperty({ description: 'Обновлено', example: new Date().toISOString() }) updatedAt!: Date;
}

export class TransactionDto {
  @ApiProperty({ example: 123 }) id!: number;
  @ApiProperty({ enum: TransactionKind }) kind!: TransactionKind;
  @ApiProperty({ enum: TransactionStatus }) status!: TransactionStatus;
  @ApiProperty({ description: 'Входящая сумма (decimal string)', example: '1000' }) amount_in!: string;
  @ApiProperty({ enum: Asset }) asset_in!: Asset;
  @ApiProperty({ description: 'Исходящая сумма (decimal string)', example: '1000' }) amount_out!: string;
  @ApiProperty({ enum: Asset }) asset_out!: Asset;
  @ApiPropertyOptional({ description: 'Комиссия (decimal string)', example: '10' }) fee_amount?: string | null;
  @ApiPropertyOptional({ description: 'Цена в USD (decimal string)', example: '60000' }) price_usd?: string | null;
  @ApiPropertyOptional({ description: 'Номинал в USD (decimal string)', example: '1000' }) notional_usd?: string | null;
  @ApiPropertyOptional({ example: '0xabc...' }) tx_hash?: string | null;
  @ApiPropertyOptional({ example: 456 }) bank_op_id?: number | null;
  @ApiPropertyOptional({ example: 1 }) sender_customer_id?: number | null;
  @ApiPropertyOptional({ example: 2 }) receiver_customer_id?: number | null;
  @ApiPropertyOptional({ example: '0xSender' }) sender_wallet_address?: string | null;
  @ApiPropertyOptional({ example: '0xReceiver' }) receiver_wallet_address?: string | null;
  @ApiPropertyOptional({ example: 'TXYZ...' }) external_address?: string | null;
  @ApiPropertyOptional({ example: 'Комментарий' }) comment?: string | null;
  @ApiProperty({ example: new Date().toISOString() }) createdAt!: Date;
}

export class AntiFraudCaseDto {
  @ApiProperty({ example: 10 }) id!: number;
  @ApiProperty({ example: 123 }) transaction_id!: number;
  @ApiProperty({ enum: AntiFraudRuleKey }) rule_key!: AntiFraudRuleKey;
  @ApiProperty({ enum: AntiFraudCaseStatus }) status!: AntiFraudCaseStatus;
  @ApiPropertyOptional({ example: 'Triggered by antifraud rule' }) reason?: string | null;
  @ApiProperty({ example: new Date().toISOString() }) createdAt!: Date;
  @ApiProperty({ example: new Date().toISOString() }) updatedAt!: Date;
  @ApiProperty({ type: () => TransactionDto }) transaction!: TransactionDto;
}

export class SimpleOkDto {
  @ApiProperty({ example: true }) ok!: boolean;
}
