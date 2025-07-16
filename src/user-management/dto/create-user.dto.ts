import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEmail } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ description: 'Имя', example: 'Алексей' })
  @IsString()
  first_name: string;

  @ApiProperty({ description: 'Отчество', example: 'Иванович' })
  @IsString()
  middle_name: string;

  @ApiProperty({ description: 'Фамилия', example: 'Петров' })
  @IsString()
  last_name: string;

  @ApiProperty({ description: 'Телефон', example: '+996700000000' })
  @IsString()
  phone: string;

  @ApiProperty({ description: 'Email', example: 'user@mail.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Блокчейн-адрес пользователя', example: '0x1234abcd5678ef00...' })
  @IsString()
  address: string;

  @ApiProperty({ description: 'Приватный ключ пользователя', example: '0xabcdef...' })
  @IsString()
  private_key: string;
}