import { ApiProperty } from '@nestjs/swagger';

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
