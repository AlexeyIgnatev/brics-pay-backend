import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional } from 'class-validator';
import { Currency } from '../../users/enums/currency';

export class GetTransactions {
  @ApiProperty({
    enum: Currency,
    isArray: true,
    enumName: 'Currency',
  })
  @IsOptional()
  @IsEnum(Currency, { each: true })
  currency?: Currency[];

  @IsNumber()
  @IsOptional()
  from_time: number;

  @IsNumber()
  @IsOptional()
  to_time: number;

  @IsOptional()
  take: number;

  @IsOptional()
  skip: number;
}