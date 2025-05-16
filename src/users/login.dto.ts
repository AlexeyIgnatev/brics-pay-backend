import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: 'Имя пользователя' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ description: 'Пароль' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class BalanceDto {
  @ApiProperty({ description: 'Баланс в сомах' })
  SOM: number;

  @ApiProperty({ description: 'Баланс в электронных сомах' })
  ESOM: number;
}

export class LoginResponseDto {
  @ApiProperty({ description: 'Идентификатор клиента' })
  customer_id: number;

  @ApiProperty({ description: 'Баланс' })
  balance: BalanceDto;

  @ApiProperty({ description: 'Имя' })
  first_name: string;

  @ApiProperty({ description: 'Отчество' })
  middle_name: string;

  @ApiProperty({ description: 'Фамилия' })
  last_name: string;

  @ApiProperty({ description: 'Телефон' })
  phone: string;

  @ApiProperty({ description: 'Email' })
  email: string;
}

export class ExtendedLoginResponseDto extends LoginResponseDto {
  @ApiProperty({ description: 'Комиссия площадки' })
  platform_fee: number;
}