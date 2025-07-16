import { ApiProperty } from '@nestjs/swagger';
import { BankToWalletTransactionDto } from './bank-to-wallet-transaction.dto';

export class PaginatedBankToWalletResponseDto {
  @ApiProperty({ type: [BankToWalletTransactionDto], description: 'Список переводов с банка на кошелёк' })
  items: BankToWalletTransactionDto[];

  @ApiProperty({ example: 35, description: 'Общее количество найденных транзакций' })
  total: number;

  @ApiProperty({ example: 0, description: 'Смещение (offset)' })
  offset: number;

  @ApiProperty({ example: 20, description: 'Размер страницы (limit)' })
  limit: number;
}