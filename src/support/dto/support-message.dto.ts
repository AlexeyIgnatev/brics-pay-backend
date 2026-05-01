import { ApiProperty } from '@nestjs/swagger';

export class SupportMessageDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  text: string;

  @ApiProperty({ enum: ['USER', 'ASSISTANT'] })
  role: string;

  @ApiProperty()
  created_at: number;
}

