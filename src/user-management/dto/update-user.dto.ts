import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsEmail, IsOptional } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({ description: 'Имя', example: 'Алексей' })
  @IsString()
  @IsOptional()
  first_name?: string;

  @ApiPropertyOptional({ description: 'Отчество', example: 'Иванович' })
  @IsString()
  @IsOptional()
  middle_name?: string;

  @ApiPropertyOptional({ description: 'Фамилия', example: 'Петров' })
  @IsString()
  @IsOptional()
  last_name?: string;

  @ApiPropertyOptional({ description: 'Телефон', example: '+996700000000' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ description: 'Email', example: 'user@mail.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: 'Блокчейн-адрес пользователя', example: '0x1234abcd5678ef00...' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ description: 'Приватный ключ пользователя', example: '0xabcdef...' })
  @IsString()
  @IsOptional()
  private_key?: string;
}