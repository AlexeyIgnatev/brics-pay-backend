import { ApiProperty } from '@nestjs/swagger';

export class BlockchainConfigDto {
  @ApiProperty({ example: 0.5, description: 'Текущий процент комиссии за перевод между кошельком и банковским счетом (в %)' })
  commission_percent: number;

  @ApiProperty({ example: 'AVAILABLE', description: 'Статус транзакций в блокчейне (AVAILABLE — доступны, SUSPENDED — приостановлены)' })
  blockchain_status: 'AVAILABLE' | 'SUSPENDED';
}