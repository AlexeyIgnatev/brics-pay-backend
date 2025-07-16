import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsString, IsDateString, IsIn } from 'class-validator';

export class TransactionStatsFilterDto {
  @ApiPropertyOptional({ description: 'Тип транзакции', enum: ['bank-to-bank', 'wallet-to-wallet', 'bank-to-wallet', 'wallet-to-bank'] })
  @IsOptional()
  @IsString()
  @IsIn(['bank-to-bank', 'wallet-to-wallet', 'bank-to-wallet', 'wallet-to-bank'])
  type?: string;

  @ApiPropertyOptional({ description: 'Сумма (точная)' })
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional({ description: 'Минимальная сумма' })
  @IsOptional()
  @IsNumber()
  amount_min?: number;

  @ApiPropertyOptional({ description: 'Максимальная сумма' })
  @IsOptional()
  @IsNumber()
  amount_max?: number;

  @ApiPropertyOptional({ description: 'Статус операции', example: 'SUCCESS' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Комментарий/назначение (поиск по вхождению)' })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({ description: 'Дата "с"', type: 'string', format: 'date-time' })
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional({ description: 'Дата "по"', type: 'string', format: 'date-time' })
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @ApiPropertyOptional({ description: 'Хэш транзакции' })
  @IsOptional()
  @IsString()
  tx_hash?: string;

  @ApiPropertyOptional({ description: 'Счёт отправителя' })
  @IsOptional()
  @IsString()
  sender_account?: string;

  @ApiPropertyOptional({ description: 'Счёт получателя' })
  @IsOptional()
  @IsString()
  receiver_account?: string;

  @ApiPropertyOptional({ description: 'Адрес отправителя (криптокошелёк)' })
  @IsOptional()
  @IsString()
  sender_address?: string;

  @ApiPropertyOptional({ description: 'Адрес получателя (криптокошелёк)' })
  @IsOptional()
  @IsString()
  receiver_address?: string;
}