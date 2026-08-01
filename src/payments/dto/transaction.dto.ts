import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency } from '../../users/enums/currency';
import { ReceiptConversionSide } from './transaction-receipt.dto';
import { TransactionType } from '../enums/transaction-type';

export class TransactionDto {
  @ApiPropertyOptional({ description: 'Transaction ID in DB' })
  id?: number;

  @ApiPropertyOptional({ description: 'Transaction ID for mobile clients' })
  transaction_id?: number;

  @ApiProperty({ enum: [Currency.SOM, Currency.ESOM, Currency.USDT_TRC20] })
  currency: Currency;

  amount: number;

  @ApiProperty({ enum: TransactionType })
  type: TransactionType;

  @ApiPropertyOptional({ enum: ReceiptConversionSide })
  conversion_side?: ReceiptConversionSide;

  @ApiPropertyOptional({
    description: 'Recipient full name for an outgoing user transfer',
  })
  recipient_full_name?: string;

  @ApiPropertyOptional({
    description: 'Sender full name for an incoming user transfer',
  })
  sender_full_name?: string;

  successful: boolean;

  created_at: number;
}
