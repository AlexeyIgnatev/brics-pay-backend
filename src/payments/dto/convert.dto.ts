import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber } from 'class-validator';
import { Currency } from '../../users/enums/currency';

export class ConvertDto {
  @ApiProperty({ enum: Currency })
  @IsEnum(Currency)
  asset_from: Currency;

  @ApiProperty({ enum: Currency })
  @IsEnum(Currency)
  asset_to: Currency;

  @ApiProperty({ description: 'Количество исходного актива' })
  @IsNumber()
  @IsNotEmpty()
  amount_from: number;
}
