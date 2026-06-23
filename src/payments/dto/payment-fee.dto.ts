import { ApiProperty } from '@nestjs/swagger';
import { TariffOperation } from '@prisma/client';

export class PaymentFeeDto {
  @ApiProperty({ enum: TariffOperation })
  operation: TariffOperation;

  @ApiProperty()
  percent_fee: string;

  @ApiProperty()
  fixed_fee: string;
}
