import { ApiProperty } from '@nestjs/swagger';
import { WalletDto } from './wallet.dto';

export class UserInfoDto {
  @ApiProperty({ description: 'Идентификатор клиента' })
  customer_id: number;

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

  @ApiProperty({ description: 'Приватный ключ пользователя', example: '0xabcdef...' })
  private_key?: string;
}

export class UserDto extends UserInfoDto {
  @ApiProperty({
    description: 'Кошельки',
    type: () => WalletDto,
    isArray: true,
  })
  wallets: WalletDto[];
}