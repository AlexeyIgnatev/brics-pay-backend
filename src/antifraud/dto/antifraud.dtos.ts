import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumberString, IsOptional, IsString, Min } from 'class-validator';

export class UpdateRuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  period_days?: number | null;

  @ApiPropertyOptional({ description: 'Порог в сомах' })
  @IsOptional()
  @IsNumberString()
  threshold_som?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  min_count?: number | null;

  @ApiPropertyOptional({ description: 'Порог в процентах (0-100)' })
  @IsOptional()
  @IsNumberString()
  percent_threshold?: string | null;

}
