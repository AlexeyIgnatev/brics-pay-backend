import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

export class BrowserWalletRegisterDto {
  @ApiPropertyOptional({
    description: 'Stable internal customer id for the browser wallet',
    example: 910000001,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  customer_id?: number;

  @ApiProperty({
    description: 'TRON private key in hex format',
    example: '5ebf7165f0afb067f4090c1bceb836481a643fa28c85eedc912c7fcc25f0c3bf',
  })
  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/, {
    message: 'private_key must be a 64-char hex string',
  })
  private_key!: string;

  @ApiPropertyOptional({
    description: 'Optional TRON address; the server will derive and normalize it',
    example: 'TQYvtaMVomk4BFgGPNjnEadrnVaLAqS5Kj',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  address?: string;
}

