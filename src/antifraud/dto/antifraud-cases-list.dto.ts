import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { AntiFraudCaseStatus } from '@prisma/client';
import { TransactionsListDto, TransactionItemDto } from '../../transactions/dto/transactions-list.dto';

export class AntifraudCasesListDto {
  @ApiPropertyOptional({ type: [String], description: 'Типы транзакций', example: ['BANK_TO_BANK', 'WALLET_TO_WALLET'] })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (value == null ? undefined : Array.isArray(value) ? value : [value]))
  kind?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Статусы транзакций', example: ['SUCCESS', 'FAILED', 'REJECTED'] })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (value == null ? undefined : Array.isArray(value) ? value : [value]))
  status?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Актив/валюта', example: ['ESOM', 'SOM'] })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (value == null ? undefined : Array.isArray(value) ? value : [value]))
  asset?: string[];

  @ApiPropertyOptional({ description: 'Дата c (ISO) по полю transaction.createdAt' })
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional({ description: 'Дата по (ISO) по полю transaction.createdAt' })
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @ApiPropertyOptional({ description: 'Минимальная сумма (SOM), фильтр по transaction.amount_out' })
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  amount_min?: number;

  @ApiPropertyOptional({ description: 'Максимальная сумма (SOM), фильтр по transaction.amount_out' })
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  amount_max?: number;

  @ApiPropertyOptional({ description: 'ID операции банка (bank_op_id) транзакции' })
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

  @ApiPropertyOptional({ enum: ['createdAt', 'amount', 'status', 'kind'], default: 'createdAt' })
  @IsOptional()
  @IsIn(['createdAt', 'amount', 'status', 'kind'])
  sort_by?: 'createdAt' | 'amount' | 'status' | 'kind';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_dir?: 'asc' | 'desc';

  @ApiPropertyOptional({ enum: ['OPEN', 'APPROVED', 'REJECTED'], description: 'Статус кейса', default: 'OPEN' })
  @IsOptional()
  @IsIn(['OPEN', 'APPROVED', 'REJECTED'])
  @Transform(({ value }) => (value == null ? 'OPEN' : value))
  case_status?: AntiFraudCaseStatus | 'OPEN' | 'APPROVED' | 'REJECTED' = 'OPEN';

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

export class AntiFraudCaseItemDto {
  @ApiProperty() id!: number;
  @ApiProperty({ enum: ['OPEN','APPROVED','REJECTED'] }) status!: string;
  @ApiProperty() rule_key!: string;
  @ApiProperty({ required: false }) reason?: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiProperty({ type: () => TransactionItemDto }) transaction!: TransactionItemDto;
}

export class AntifraudCasesListResponseDto {
  @ApiProperty() total!: number;
  @ApiProperty() offset!: number;
  @ApiProperty() limit!: number;
  @ApiProperty({ type: [AntiFraudCaseItemDto] }) items!: AntiFraudCaseItemDto[];
}
