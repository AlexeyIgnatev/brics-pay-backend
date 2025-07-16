import { ApiProperty } from '@nestjs/swagger';

export class WalletToBankTransactionDto {
  @ApiProperty({ example: 9100, description: 'ID операции в банке' })
  bank_op_id: number;

  @ApiProperty({ example: '0xabc123...', description: 'Хэш транзакции' })
  tx_hash: string;

  @ApiProperty({ example: 5000, description: 'Сумма' })
  amount: number;

  @ApiProperty({ example: 'Обмен на фиат', description: 'Комментарий' })
  comment: string;

  @ApiProperty({ example: '2024-07-16T10:00:00.000Z', type: 'string', format: 'date-time', description: 'Дата операции' })
  date: Date;

  @ApiProperty({ example: '40702810123456789012', description: 'Счёт получателя в банке' })
  receiver_account: string;

  @ApiProperty({ example: '0xdef456...', description: 'Адрес отправителя в блокчейне' })
  sender_address: string;

  @ApiProperty({ example: 'SUCCESS', description: 'Статус операции' })
  status: string;
}