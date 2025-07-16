import { ApiProperty } from '@nestjs/swagger';

export class UserBlockStatusDto {
  @ApiProperty({ example: 101, description: 'ID пользователя' })
  user_id: number;

  @ApiProperty({ example: true, description: 'Признак, что пользователь заблокирован' })
  blocked: boolean;
}