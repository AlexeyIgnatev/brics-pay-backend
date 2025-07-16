import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min, Max } from 'class-validator';

export class UpdateCommissionDto {
  @ApiProperty({ example: 1.5, description: 'Новый процент комиссии, от 0 до 100' })
  @IsNumber()
  @Min(0)
  @Max(100)
  commission_percent: number;
}