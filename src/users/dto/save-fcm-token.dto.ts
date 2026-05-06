import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class SaveFcmTokenDto {
  @ApiProperty({ description: 'FCM token устройства' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ enum: ['android', 'ios'], default: 'android' })
  @IsString()
  @IsIn(['android', 'ios'])
  platform: 'android' | 'ios';
}
