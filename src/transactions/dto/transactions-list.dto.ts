import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class TransactionsListDto {
  @ApiPropertyOptional({ type: [String], description: 'Transaction kinds', example: ['BANK_TO_BANK', 'WALLET_TO_WALLET'] })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (value == null ? undefined : Array.isArray(value) ? value : [value]))
  kind?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Statuses', example: ['SUCCESS', 'FAILED'] })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (value == null ? undefined : Array.isArray(value) ? value : [value]))
  status?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Asset/currency', example: ['ESOM', 'SOM'] })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (value == null ? undefined : Array.isArray(value) ? value : [value]))
  asset?: string[];

  @ApiPropertyOptional({ description: 'Date from (ISO)' })
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional({ description: 'Date to (ISO)' })
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @ApiPropertyOptional({ description: 'Minimum amount (SOM)' })
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  amount_min?: number;

  @ApiPropertyOptional({ description: 'Maximum amount (SOM)' })
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  amount_max?: number;

  @ApiPropertyOptional({ description: 'Bank operation ID (bank_op_id)' })
  @IsOptional()
  @IsInt()
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  id?: number;

  @ApiPropertyOptional({ description: 'Transaction hash' })
  @IsOptional()
  @IsString()
  tx_hash?: string;

  @ApiPropertyOptional({ description: 'Search by sender (FIO/phone/email/wallet)' })
  @IsOptional()
  @IsString()
  sender?: string;

  @ApiPropertyOptional({ description: 'Search by receiver (FIO/phone/email/wallet)' })
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
  @ApiProperty({ description: 'Operation amount in asset units' }) amount: number;
  @ApiProperty({ required: false, description: 'Commission amount in operation asset units' }) fee_amount?: number;
  @ApiProperty({ required: false }) asset?: string;
  @ApiProperty({ required: false }) tx_hash?: string;
  @ApiProperty({ required: false }) bank_op_id?: number;
  @ApiProperty({ required: false }) sender_customer_id?: number;
  @ApiProperty({ required: false }) receiver_customer_id?: number;
  @ApiProperty({ required: false, description: 'Sender ABS ID (alias of sender_customer_id)' }) sender_abs_id?: number;
  @ApiProperty({ required: false, description: 'Receiver ABS ID (alias of receiver_customer_id)' }) receiver_abs_id?: number;
  @ApiProperty({ required: false, description: 'Client ABS ID for transaction row' }) client_abs_id?: number;
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
