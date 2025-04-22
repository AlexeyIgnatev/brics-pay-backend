import { IsNotEmpty, IsString } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';

export class PaymentDto {
  @ApiProperty({ description: 'Сумма платежа' })
  @IsNumber()
  @IsNotEmpty()
  amount: number;
}

export class TransferDto {
  @ApiProperty({ description: 'Сумма платежа' })
  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @ApiProperty({ description: 'Номер телефона получателя' })
  @IsString()
  @IsNotEmpty()
  phone_number: string;
}
