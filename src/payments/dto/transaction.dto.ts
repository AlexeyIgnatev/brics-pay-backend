import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency } from '../../users/enums/currency';
import { ReceiptConversionSide } from './transaction-receipt.dto';
import { TransactionType } from '../enums/transaction-type';

export class TransactionDto {
  @ApiPropertyOptional({ description: 'Transaction ID in DB' })
  id?: number;

  @ApiPropertyOptional({ description: 'Transaction ID for mobile clients' })
  transaction_id?: number;

  @ApiProperty({ enum: Currency })
  currency: Currency;

  amount: number;

  @ApiProperty({ enum: TransactionType })
  type: TransactionType;

  @ApiPropertyOptional({ enum: ReceiptConversionSide })
  conversion_side?: ReceiptConversionSide;

  successful: boolean;

  created_at: number;
}
