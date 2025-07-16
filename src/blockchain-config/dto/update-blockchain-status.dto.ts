import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsIn } from 'class-validator';

export class UpdateBlockchainStatusDto {
  @ApiProperty({
    example: 'SUSPENDED',
    description: 'Новый статус транзакций в блокчейне (AVAILABLE — доступны, SUSPENDED — приостановлены)',
    enum: ['AVAILABLE', 'SUSPENDED'],
  })
  @IsString()
  @IsIn(['AVAILABLE', 'SUSPENDED'])
  blockchain_status: 'AVAILABLE' | 'SUSPENDED';
}