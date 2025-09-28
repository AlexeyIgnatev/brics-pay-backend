import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AdminListQueryDto {
  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Поиск по имени' })
  @IsOptional()
  @IsString()
  firstNameQuery?: string;

  @ApiPropertyOptional({ description: 'Поиск по фамилии' })
  @IsOptional()
  @IsString()
  lastNameQuery?: string;

  @ApiPropertyOptional({ description: 'Поиск по email' })
  @IsOptional()
  @IsString()
  emailQuery?: string;

  @ApiPropertyOptional({ description: 'Роли для фильтра', type: [String] })
  @IsOptional()
  @IsArray()
  roles?: string[];

  @ApiPropertyOptional({ description: 'created_at от', type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'created_at до', type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiPropertyOptional({ description: 'Сортировка по имени', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortFirstName?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'Сортировка по фамилии', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortLastName?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'Сортировка по email', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortEmail?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'Сортировка по времени создания', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortCreatedAt?: 'asc' | 'desc';
}
