import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({
    description: 'Блокчейн-адрес пользователя',
    example: '0x1234abcd5678ef00...',
  })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({
    description: 'Приватный ключ пользователя',
    example: '0xabcdef...',
  })
  @IsString()
  @IsOptional()
  private_key?: string;
}
