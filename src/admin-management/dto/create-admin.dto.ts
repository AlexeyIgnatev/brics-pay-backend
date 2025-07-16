import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class CreateAdminDto {
  @ApiProperty({ example: 'superuser', description: 'Уникальное имя пользователя (логин)' })
  @IsString()
  @IsNotEmpty()
  username: string;

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

  @ApiProperty({ example: 'admin', description: 'Роль администратора (например: admin, manager, operator)' })
  @IsString()
  @IsNotEmpty()
  role: string;
}