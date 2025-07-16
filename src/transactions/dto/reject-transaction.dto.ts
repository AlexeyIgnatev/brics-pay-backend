import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsNumber, IsString } from 'class-validator';

export class RejectTransactionDto {
  @ApiPropertyOptional({ description: 'ID транзакции (для банковских)' })
  @IsOptional()
  @IsNumber()
  id?: number;

  @ApiPropertyOptional({ description: 'Хэш транзакции (для блокчейна)' })
  @IsOptional()
  @IsString()
  tx_hash?: string;
}