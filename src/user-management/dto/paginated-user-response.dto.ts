import { ApiProperty } from '@nestjs/swagger';
import { UserInfoDto } from '../../users/dto/user-info.dto';

export class PaginatedUserResponseDto {
  @ApiProperty({ type: [UserInfoDto], description: 'Список пользователей на текущей странице' })
  items: UserInfoDto[];

  @ApiProperty({ example: 100, description: 'Общее количество пользователей' })
  total: number;

  @ApiProperty({ example: 0, description: 'Смещение (offset) текущей страницы' })
  offset: number;

  @ApiProperty({ example: 10, description: 'Количество элементов на странице (limit)' })
  limit: number;
}