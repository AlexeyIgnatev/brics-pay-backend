import { ApiProperty } from '@nestjs/swagger';
import { WalletToBankTransactionDto } from './wallet-to-bank-transaction.dto';

export class PaginatedWalletToBankResponseDto {
  @ApiProperty({ type: [WalletToBankTransactionDto], description: 'Список переводов с кошелька на банк' })
  items: WalletToBankTransactionDto[];

  @ApiProperty({ example: 19, description: 'Общее количество найденных транзакций' })
  total: number;

  @ApiProperty({ example: 0, description: 'Смещение (offset)' })
  offset: number;

  @ApiProperty({ example: 20, description: 'Размер страницы (limit)' })
  limit: number;
}