import { ApiProperty } from '@nestjs/swagger';
import { AdminResponseDto } from './admin-response.dto';

export class PaginatedAdminResponseDto {
  @ApiProperty({ type: [AdminResponseDto], description: 'Список администраторов на текущей странице' })
  items: AdminResponseDto[];

  @ApiProperty({ example: 100, description: 'Общее количество администраторов' })
  total: number;

  @ApiProperty({ example: 0, description: 'Смещение (offset) текущей страницы' })
  offset: number;

  @ApiProperty({ example: 10, description: 'Количество элементов на странице (limit)' })
  limit: number;
}