import { ApiQuery } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class PaginateParams {
  @IsOptional()
  @IsNumber()
  @Min(0)
  skip?: number; // Для пагинации (сколько пропустить)

  @IsOptional()
  @IsNumber()
  @Min(1)
  take?: number; // Для пагинации (сколько взять)
}
