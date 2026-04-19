import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsOptional } from 'class-validator';
import { Currency } from '../../users/enums/currency';
import { TransactionType } from '../enums/transaction-type';

export enum ReceiptConversionSide {
  IN = 'IN',
  OUT = 'OUT',
}

export class TransactionReceiptRequestDto {
  @ApiProperty({ description: 'ID транзакции в БД', example: 12345 })
  @IsInt()
  @IsNotEmpty()
  transaction_id: number;

  @ApiProperty({
    required: false,
    enum: ReceiptConversionSide,
    description: 'Сторона конвертации для отображения в квитанции (только для конвертаций)',
    example: ReceiptConversionSide.OUT,
  })
  @IsOptional()
  @IsEnum(ReceiptConversionSide)
  conversion_side?: ReceiptConversionSide;
}

export class TransactionReceiptDto {
  @ApiProperty()
  successful: boolean;

  @ApiProperty()
  amount: number;

  @ApiProperty({ enum: TransactionType })
  type: TransactionType;

  @ApiProperty({ enum: Currency })
  currency: Currency;

  @ApiProperty({ description: 'Unix time в миллисекундах' })
  created_at: number;

  @ApiProperty({ description: 'Комиссия' })
  fee: number;

  @ApiProperty({ description: 'Реквизиты счета получателя/назначения (маскированно)' })
  account_details: string;

  @ApiProperty({ description: 'Получатель (ФИО)' })
  recipient_full_name: string;

  @ApiProperty({ description: 'Оплачено со счета (маскированно)' })
  paid_from_account: string;

  @ApiProperty({ description: 'Номер квитанции', example: 'TX-12345-1732579200000' })
  receipt_number: string;
}
