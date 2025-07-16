import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsDateString, IsNumber } from 'class-validator';

export class TransactionFilterDto {
  @ApiPropertyOptional({ description: 'Сумма (точное совпадение)' })
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

  @ApiPropertyOptional({ description: 'ID (для банковских операций)' })
  @IsOptional()
  @IsNumber()
  id?: number;

  @ApiPropertyOptional({ description: 'Комментарий (поиск по вхождению)' })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({ description: 'Дата операции (точная)' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ description: 'Дата "с"' })
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional({ description: 'Дата "по"' })
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @ApiPropertyOptional({ description: 'Статус операции' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Хэш транзакции (для блокчейна)' })
  @IsOptional()
  @IsString()
  tx_hash?: string;
}