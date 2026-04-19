import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency } from '../../users/enums/currency';
import { TransactionType } from '../enums/transaction-type';

export class TransactionDto {
  @ApiPropertyOptional({ description: 'ID транзакции в БД' })
  id?: number;

  @ApiProperty({ enum: Currency })
  currency: Currency;

  amount: number;

  @ApiProperty({ enum: TransactionType })
  type: TransactionType;

  successful: boolean;

  created_at: number;
}
