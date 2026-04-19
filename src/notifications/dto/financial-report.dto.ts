import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsInt, IsOptional, Min } from 'class-validator';

export class SendFinancialReportRequestDto {
  @ApiPropertyOptional({
    description: 'Email получателя отчета. Если не передан, используется email текущего пользователя.',
    example: 'client@example.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: 'Начало периода отчета (Unix time в миллисекундах). Если не передан, берутся последние 30 дней.',
    example: 1744972800000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  from_time?: number;

  @ApiPropertyOptional({
    description: 'Конец периода отчета (Unix time в миллисекундах). Если не передан, используется текущее время.',
    example: 1747564800000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  to_time?: number;
}

export class SendFinancialReportResponseDto {
  @ApiProperty({ example: true })
  successful: boolean;
}

