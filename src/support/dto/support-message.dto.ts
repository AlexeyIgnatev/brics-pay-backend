import { ApiProperty } from '@nestjs/swagger';

export class SupportMessageDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  ticket_id: number;

  @ApiProperty()
  text: string;

  @ApiProperty({ enum: ['USER', 'ASSISTANT', 'ADMIN'] })
  role: string;

  @ApiProperty()
  created_at: number;
}
