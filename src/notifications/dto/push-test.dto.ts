import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PushDataPayloadDto {
  @ApiProperty({ default: 'Заголовок уведомления' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ default: 'Текст уведомления' })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiProperty({ required: false, description: 'Опциональная ссылка' })
  @IsString()
  @IsOptional()
  url?: string;
}

export class TestPushToTokenDto extends PushDataPayloadDto {
  @ApiProperty({ description: 'FCM token' })
  @IsString()
  @IsNotEmpty()
  token: string;
}
