import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { TransactionsListResponseDto } from './transactions-list.dto';

export class TransactionsStatsTodayDto {
  @ApiProperty({ description: 'Сумма всех операций за период в SOM' })
  total_amount_som: number | string;

  @ApiProperty({ description: 'Сумма BANK_TO_BANK в SOM' })
  bank_to_bank_som: number | string;

  @ApiProperty({ description: 'Сумма WALLET_TO_WALLET в SOM' })
  wallet_to_wallet_som: number | string;

  @ApiProperty({ description: 'Количество пользователей в системе' })
  users_count: number;

  @ApiProperty()
  date_from: string;

  @ApiProperty()
  date_to: string;
}

export class TransactionsStatsQueryDto {
  @ApiPropertyOptional({ description: 'Дата начала периода (ISO)' })
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional({ description: 'Дата окончания периода (ISO)' })
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @ApiPropertyOptional({ type: [String], description: 'Статусы транзакций' })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (value == null ? undefined : Array.isArray(value) ? value : [value]))
  status?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Типы операций' })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (value == null ? undefined : Array.isArray(value) ? value : [value]))
  kind?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Валюты (Asset): SOM, ESOM, BTC, ETH, USDT_TRC20' })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (value == null ? undefined : Array.isArray(value) ? value : [value]))
  asset?: string[];

  @ApiPropertyOptional({ enum: ['sum', 'count'], default: 'sum' })
  @IsOptional()
  @IsIn(['sum', 'count'])
  metric?: 'sum' | 'count' = 'sum';

  @ApiPropertyOptional({ enum: ['day', 'week', 'month'], default: 'day' })
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  group_by?: 'day' | 'week' | 'month' = 'day';

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

export class TransactionsStatsSeriesPointDto {
  @ApiProperty({ description: 'Дата/метка группы (ISO)' })
  date: string;

  @ApiProperty({ description: 'Значение метрики для группы' })
  value: number;
}

export class TransactionsStatsSummaryDto {
  @ApiProperty({ description: 'Общая сумма операций в SOM за период' })
  total_sum_som: number;

  @ApiProperty({ description: 'Общее количество транзакций за период' })
  total_count: number;

  @ApiPropertyOptional({ description: 'Валюта с наибольшей суммой' })
  top_currency_by_sum?: string;

  @ApiPropertyOptional({ description: 'Валюта с наибольшим количеством' })
  top_currency_by_count?: string;

  @ApiPropertyOptional({ description: 'Наиболее активный день (по количеству), ISO' })
  most_active_day?: string;

  @ApiPropertyOptional({ description: 'Средний чек, SOM' })
  average_check_som?: number;
}

export class TransactionsStatsResponseDto {
  @ApiProperty({ type: [TransactionsStatsSeriesPointDto] })
  series: TransactionsStatsSeriesPointDto[];

  @ApiProperty({ type: () => TransactionsStatsSummaryDto })
  summary: TransactionsStatsSummaryDto;

  @ApiPropertyOptional({ description: 'Данные таблицы транзакций (та же структура, что и /transactions/list)' })
  table?: TransactionsListResponseDto;
}
