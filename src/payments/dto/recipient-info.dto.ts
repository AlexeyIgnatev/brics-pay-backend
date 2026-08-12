import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { Currency } from '../../users/enums/currency';

function trimOptionalString({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export class RecipientInfoRequestDto {
  @ApiPropertyOptional({ example: '996777960777', nullable: true })
  @IsOptional()
  @IsString()
  @Transform(trimOptionalString)
  phone_number?: string | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  @IsOptional()
  @IsString()
  @Transform(trimOptionalString)
  address?: string | null;

  @ApiProperty({ enum: [Currency.SOM, Currency.ESOM, Currency.USDT_TRC20] })
  @IsIn([Currency.SOM, Currency.ESOM, Currency.USDT_TRC20])
  currency: Currency;
}

export class RecipientInfoResponseDto {
  @ApiProperty({ example: 'Иван' })
  first_name: string;

  @ApiProperty({ example: 'Иванович' })
  middle_name: string;

  @ApiProperty({ example: 'Иванов' })
  last_name: string;
}
