import { ApiProperty } from '@nestjs/swagger';
import { BankToBankTransactionDto } from './bank-to-bank-transaction.dto';

export class PaginatedBankToBankResponseDto {
  @ApiProperty({ type: [BankToBankTransactionDto], description: 'Список банковских транзакций' })
  items: BankToBankTransactionDto[];

  @ApiProperty({ example: 120, description: 'Общее количество найденных транзакций' })
  total: number;

  @ApiProperty({ example: 0, description: 'Смещение (offset)' })
  offset: number;

  @ApiProperty({ example: 20, description: 'Размер страницы (limit)' })
  limit: number;
}