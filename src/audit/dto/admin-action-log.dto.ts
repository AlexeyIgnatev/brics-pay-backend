import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AdminActionLogItemDto {
  @ApiProperty() id: number;
  @ApiProperty() admin_id: number;
  @ApiProperty() ip: string;
  @ApiProperty() action: string;
  @ApiPropertyOptional() details: string | null;
  @ApiProperty() createdAt: Date;
}

export class AdminActionLogsResponseDto {
  @ApiProperty() total: number;
  @ApiProperty() offset: number;
  @ApiProperty() limit: number;
  @ApiProperty({ type: [AdminActionLogItemDto] }) items: AdminActionLogItemDto[];
}

export class AdminActionLogsQueryDto {
  @ApiProperty({ required: false, enum: ['createdAt', 'admin_id', 'action'], default: 'createdAt' })
  @IsOptional()
  @IsIn(['createdAt', 'admin_id', 'action'])
  sort_by?: 'createdAt' | 'admin_id' | 'action' = 'createdAt';

  @ApiProperty({ required: false, enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_dir?: 'asc' | 'desc' = 'desc';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  admin_id?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  action_query?: string;

  @ApiProperty({ required: false, example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => (value != null ? Number(value) : 0))
  offset?: number = 0;

  @ApiProperty({ required: false, example: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value != null ? Number(value) : 20))
  limit?: number = 20;
}
