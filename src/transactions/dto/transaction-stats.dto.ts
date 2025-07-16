import { ApiProperty } from '@nestjs/swagger';

export class TransactionStatsDto {
  @ApiProperty({ example: 25, description: 'Всего транзакций за период' })
  total_count: number;

  @ApiProperty({ example: 123456, description: 'Общая сумма транзакций за период' })
  total_amount: number;
}