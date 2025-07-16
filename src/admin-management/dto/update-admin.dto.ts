import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class UpdateAdminDto {
  @ApiPropertyOptional({ example: 'newuser', description: 'Новое имя пользователя (логин)' })
  @IsString()
  @IsOptional()
  username?: string;

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

  @ApiPropertyOptional({ example: 'manager', description: 'Новая роль администратора' })
  @IsString()
  @IsOptional()
  role?: string;
}