import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdatePushSettingsDto {
  @ApiProperty({ description: 'Флаг включения push-уведомлений' })
  @IsBoolean()
  pushEnabled: boolean;
}
