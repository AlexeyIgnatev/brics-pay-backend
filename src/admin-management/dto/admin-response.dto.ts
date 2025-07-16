import { ApiProperty } from '@nestjs/swagger';

export class AdminResponseDto {
  @ApiProperty({ example: 1, description: 'Уникальный идентификатор администратора' })
  id: number;

  @ApiProperty({ example: 'superuser', description: 'Имя пользователя (логин)' })
  username: string;

  @ApiProperty({ example: 'Иван', description: 'Имя администратора' })
  firstName: string;

  @ApiProperty({ example: 'Иванов', description: 'Фамилия администратора' })
  lastName: string;

  @ApiProperty({
    example: '2024-07-16T10:00:00.000Z',
    description: 'Дата и время создания пользователя',
    type: 'string',
    format: 'date-time'
  })
  createdAt: Date;

  @ApiProperty({ example: 'admin', description: 'Роль администратора' })
  role: string;
}