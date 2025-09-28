import { ApiProperty } from '@nestjs/swagger';

export class AdminResponseDto {
  @ApiProperty({ example: 1, description: 'Уникальный идентификатор администратора' })
  id: number;

  @ApiProperty({ example: 'admin@example.com', description: 'Email (логин)' })
  email: string;

  @ApiProperty({ example: 'Иван', description: 'Имя администратора' })
  firstName: string;

  @ApiProperty({ example: 'Иванов', description: 'Фамилия администратора' })
  lastName: string;

  @ApiProperty({ example: 'SUPER_ADMIN', description: 'Роль администратора' })
  role: string;

  @ApiProperty({ example: '2024-07-16T10:00:00.000Z', description: 'Дата создания', type: 'string', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ example: '2024-07-16T10:00:00.000Z', description: 'Дата обновления', type: 'string', format: 'date-time' })
  updatedAt: Date;
}