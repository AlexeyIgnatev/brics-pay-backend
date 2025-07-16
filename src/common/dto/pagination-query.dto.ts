import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Min, IsOptional } from 'class-validator';

export class PaginationQueryDto {
  @ApiPropertyOptional({ example: 0, description: 'Смещение для пагинации (по умолчанию 0)' })
  @IsOptional()
  @IsInt({ message: 'offset должен быть целым числом' })
  @Min(0, { message: 'offset не может быть меньше 0' })
  offset?: number = 0;

  @ApiPropertyOptional({ example: 10, description: 'Количество элементов на странице (по умолчанию 10)' })
  @IsOptional()
  @IsInt({ message: 'limit должен быть целым числом' })
  @Min(1, { message: 'limit должен быть больше 0' })
  limit?: number = 10;
}