import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from '../../users/dto/user.dto';

export class PaginatedUserResponseDto {
  @ApiProperty({ type: [UserDto], description: 'Список пользователей на текущей странице' })
  items: UserDto[];

  @ApiProperty({ example: 100, description: 'Общее количество пользователей' })
  total: number;

  @ApiProperty({ example: 0, description: 'Смещение (offset) текущей страницы' })
  offset: number;

  @ApiProperty({ example: 10, description: 'Количество элементов на странице (limit)' })
  limit: number;
}