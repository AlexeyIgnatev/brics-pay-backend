import { ApiProperty } from '@nestjs/swagger';

export class WalletToWalletTransactionDto {
  @ApiProperty({ example: '0xabc123...', description: 'Хэш транзакции в блокчейне' })
  tx_hash: string;

  @ApiProperty({ example: 10.5, description: 'Сумма транзакции' })
  amount: number;

  @ApiProperty({ example: '0xdef456...', description: 'Адрес получателя' })
  receiver_address: string;

  @ApiProperty({ example: '0xcontract789...', description: 'Адрес смарт контракта' })
  contract_address: string;

  @ApiProperty({ example: '2024-07-16T10:00:00.000Z', type: 'string', format: 'date-time', description: 'Дата операции' })
  date: Date;

  @ApiProperty({ example: 'SUCCESS', description: 'Статус операции' })
  status: string;
}