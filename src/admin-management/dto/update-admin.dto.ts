import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEmail } from 'class-validator';

export class UpdateAdminDto {
  @ApiPropertyOptional({ example: 'admin@example.com', description: 'Новый email (логин)' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: 'newpassword', description: 'Новый пароль (будет захеширован на сервере)' })
  @IsString()
  @IsOptional()
  password?: string;

  @ApiPropertyOptional({ example: 'Петр', description: 'Новое имя администратора' })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Петров', description: 'Новая фамилия администратора' })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional({ example: 'SUPER_ADMIN', description: 'Новая роль администратора' })
  @IsString()
  @IsOptional()
  role?: string;
}