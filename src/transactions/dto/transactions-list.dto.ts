import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class TransactionsListDto {
  @ApiPropertyOptional({ type: [String], description: 'Типы транзакций', example: ['BANK_TO_BANK', 'WALLET_TO_WALLET'] })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (value == null ? undefined : Array.isArray(value) ? value : [value]))
  kind?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Статусы', example: ['SUCCESS', 'FAILED'] })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (value == null ? undefined : Array.isArray(value) ? value : [value]))
  status?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Актив/валюта', example: ['ESOM', 'SOM'] })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (value == null ? undefined : Array.isArray(value) ? value : [value]))
  asset?: string[];

  @ApiPropertyOptional({ description: 'Дата c (ISO)' })
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional({ description: 'Дата по (ISO)' })
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @ApiPropertyOptional({ description: 'Минимальная сумма (SOM)' })
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  amount_min?: number;

  @ApiPropertyOptional({ description: 'Максимальная сумма (SOM)' })
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  amount_max?: number;

  @ApiPropertyOptional({ description: 'ID операции банка (bank_op_id)' })
  @IsOptional()
  @IsInt()
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  id?: number;

  @ApiPropertyOptional({ description: 'Хэш транзакции' })
  @IsOptional()
  @IsString()
  tx_hash?: string;

  @ApiPropertyOptional({ description: 'Поиск по отправителю (FIO/телефон/email/кошелек)' })
  @IsOptional()
  @IsString()
  sender?: string;

  @ApiPropertyOptional({ description: 'Поиск по получателю (FIO/телефон/email/кошелек)' })
  @IsOptional()
  @IsString()
  receiver?: string;

  @ApiPropertyOptional({ enum: ['createdAt', 'som_amount', 'status', 'kind'], default: 'createdAt' })
  @IsOptional()
  @IsIn(['createdAt', 'som_amount', 'status', 'kind'])
  sort_by?: 'createdAt' | 'som_amount' | 'status' | 'kind';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_dir?: 'asc' | 'desc';

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => (value != null ? Number(value) : 0))
  offset?: number = 0;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value != null ? Number(value) : 20))
  limit?: number = 20;
}

class CustomerBriefDto {
  @ApiProperty() customer_id: number;
  @ApiProperty({ required: false }) first_name?: string;
  @ApiProperty({ required: false }) middle_name?: string;
  @ApiProperty({ required: false }) last_name?: string;
  @ApiProperty({ required: false }) phone?: string;
  @ApiProperty({ required: false }) email?: string;
}

export class TransactionItemDto {
  @ApiProperty() id: number;
  @ApiProperty() kind: string;
  @ApiProperty() status: string;
  @ApiProperty({ description: 'Нормализованная сумма (в SOM)' }) som_amount: number;
  @ApiProperty({ required: false }) asset?: string;
  @ApiProperty({ required: false }) tx_hash?: string;
  @ApiProperty({ required: false }) bank_op_id?: number;
  @ApiProperty({ required: false }) sender_customer_id?: number;
  @ApiProperty({ required: false }) receiver_customer_id?: number;
  @ApiProperty({ required: false }) sender_wallet_address?: string;
  @ApiProperty({ required: false }) receiver_wallet_address?: string;
  @ApiProperty({ required: false }) comment?: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ required: false, type: () => CustomerBriefDto }) sender_customer?: CustomerBriefDto;
  @ApiProperty({ required: false, type: () => CustomerBriefDto }) receiver_customer?: CustomerBriefDto;
}

export class TransactionsListResponseDto {
  @ApiProperty() total: number;
  @ApiProperty() offset: number;
  @ApiProperty() limit: number;
  @ApiProperty({ type: [TransactionItemDto] }) items: TransactionItemDto[];
}
