import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class SupportTicketsQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'CLOSED'], default: 'OPEN' })
  @IsOptional()
  @IsIn(['OPEN', 'CLOSED'])
  status?: 'OPEN' | 'CLOSED' = 'OPEN';

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => (value != null ? Number(value) : 0))
  offset?: number = 0;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value != null ? Number(value) : 20))
  limit?: number = 20;
}
