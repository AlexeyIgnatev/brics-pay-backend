import { ApiProperty } from '@nestjs/swagger';

export class SupportTicketDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  customer_id: number;

  @ApiProperty({ enum: ['OPEN', 'CLOSED'] })
  status: string;

  @ApiProperty()
  created_at: number;

  @ApiProperty()
  last_message_at: number;

  @ApiProperty({ required: false, nullable: true })
  closed_at: number | null;
}

export class SupportTicketsListDto {
  @ApiProperty()
  total: number;

  @ApiProperty()
  offset: number;

  @ApiProperty()
  limit: number;

  @ApiProperty({ type: [SupportTicketDto] })
  items: SupportTicketDto[];
}
