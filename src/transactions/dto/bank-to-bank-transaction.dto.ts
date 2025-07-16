import { ApiProperty } from '@nestjs/swagger';

export class BankToBankTransactionDto {
  @ApiProperty({ example: 1001, description: 'ID операции' })
  id: number;

  @ApiProperty({ example: 5000, description: 'Сумма перевода' })
  amount: number;

  @ApiProperty({ example: 'Перевод ЗП', description: 'Комментарий к операции' })
  comment: string;

  @ApiProperty({ example: '2024-07-16T10:00:00.000Z', type: 'string', format: 'date-time', description: 'Дата операции' })
  date: Date;

  @ApiProperty({ example: '40702810900000001234', description: 'Счёт отправителя (IBAN или номер)' })
  sender_account: string;

  @ApiProperty({ example: '40702810123456789012', description: 'Счёт получателя (IBAN или номер)' })
  receiver_account: string;

  @ApiProperty({ example: 'SUCCESS', description: 'Статус операции (например, SUCCESS, PENDING, REJECTED)' })
  status: string;
}