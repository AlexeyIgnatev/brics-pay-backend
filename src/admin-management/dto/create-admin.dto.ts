import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEmail } from 'class-validator';

export class CreateAdminDto {
  @ApiProperty({ example: 'admin@example.com', description: 'Email (логин администратора)' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'password123', description: 'Пароль (будет захеширован на сервере)' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ example: 'Иван', description: 'Имя администратора' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Иванов', description: 'Фамилия администратора' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'SUPER_ADMIN', description: 'Роль администратора' })
  @IsString()
  @IsNotEmpty()
  role: string;
}