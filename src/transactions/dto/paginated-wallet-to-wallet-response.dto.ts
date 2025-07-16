import { ApiProperty } from '@nestjs/swagger';
import { WalletToWalletTransactionDto } from './wallet-to-wallet-transaction.dto';

export class PaginatedWalletToWalletResponseDto {
  @ApiProperty({ type: [WalletToWalletTransactionDto], description: 'Список транзакций между кошельками' })
  items: WalletToWalletTransactionDto[];

  @ApiProperty({ example: 77, description: 'Общее количество найденных транзакций' })
  total: number;

  @ApiProperty({ example: 0, description: 'Смещение (offset)' })
  offset: number;

  @ApiProperty({ example: 20, description: 'Размер страницы (limit)' })
  limit: number;
}