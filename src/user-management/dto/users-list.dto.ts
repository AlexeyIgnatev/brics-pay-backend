import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export enum UserStatusDtoEnum { ACTIVE = 'ACTIVE', FRAUD = 'FRAUD', BLOCKED = 'BLOCKED' }

export class UsersListQueryDto {
  @ApiPropertyOptional({ description: 'Поиск по ФИО/телефону/email', example: 'Иван' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: UserStatusDtoEnum, isArray: true, description: 'Фильтр по статусу' })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (value == null ? undefined : Array.isArray(value) ? value : [value]))
  status?: UserStatusDtoEnum[];

  @ApiPropertyOptional({
    enum: ['customer_id', 'fio', 'phone', 'email', 'status', 'som_balance', 'total_balance', 'createdAt'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsString()
  sort_by?: 'customer_id' | 'fio' | 'phone' | 'email' | 'status' | 'som_balance' | 'total_balance' | 'createdAt' = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsString()
  sort_dir?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => (value != null ? Number(value) : 0))
  offset?: number = 0;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value != null ? Number(value) : 20))
  limit?: number = 20;
}

export class UserBalancesDto {
  @ApiProperty({ example: 0 }) ESOM: number;
  @ApiProperty({ example: 0 }) SOM: number;
  @ApiProperty({ example: 0 }) BTC: number;
  @ApiProperty({ example: 0 }) ETH: number;
  @ApiProperty({ example: 0 }) USDT_TRC20: number;
}

export class UsersListItemDto {
  @ApiProperty() customer_id: number;
  @ApiProperty({ required: false }) first_name?: string;
  @ApiProperty({ required: false }) middle_name?: string;
  @ApiProperty({ required: false }) last_name?: string;
  @ApiProperty({ required: false }) phone?: string;
  @ApiProperty({ required: false }) email?: string;
  @ApiProperty({ enum: UserStatusDtoEnum }) status: UserStatusDtoEnum;
  @ApiProperty({ type: () => UserBalancesDto }) balances: UserBalancesDto;
  @ApiProperty({ description: 'Баланс СОМ', example: 0 }) som_balance: number;
  @ApiProperty({ description: 'Общий баланс (САЛАМ + СОМ + крипта в САЛАМ)', example: 0 }) total_balance: number;
  @ApiProperty({ required: false }) createdAt?: Date;
}

export class UsersListResponseDto {
  @ApiProperty() total: number;
  @ApiProperty() offset: number;
  @ApiProperty() limit: number;
  @ApiProperty({ type: [UsersListItemDto] }) items: UsersListItemDto[];
}

export class AdminUpdateUserDto {
  @ApiPropertyOptional()
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  first_name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  middle_name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  last_name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ enum: UserStatusDtoEnum })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  status?: UserStatusDtoEnum;
}
