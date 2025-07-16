import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class BalanceDto {
  @ApiProperty({ description: 'Баланс в сомах' })
  SOM: number;

  @ApiProperty({ description: 'Баланс в электронных сомах' })
  ESOM: number;
}

export class UserDto {
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

  @ApiProperty({ description: 'Блокчейн-адрес пользователя', example: '0x1234abcd5678ef00...' })
  address?: string;

  @ApiProperty({ description: 'Приватный ключ пользователя', example: '0xabcdef...' })
  private_key?: string;
}

export class ExtendedUserDto extends UserDto {
  @ApiProperty({ description: 'Комиссия площадки' })
  platform_fee: number;
}