import { ApiProperty } from '@nestjs/swagger';

export class StatusOKDto {
  constructor(transactionId?: number) {
    if (transactionId != null) this.transaction_id = transactionId;
  }

  status: string = 'OK';

  @ApiProperty({ required: false })
  transaction_id?: number;
}
