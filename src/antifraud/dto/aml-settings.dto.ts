import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const AML_SOURCE_TYPES = ['api', 'urls', 'file'] as const;
export type AmlSourceType = (typeof AML_SOURCE_TYPES)[number];

export class AmlWalletRuleDto {
  @ApiProperty({ example: 'TEYMgT9qm4eGtidZFvgyHgWQ754MiXMNo5' })
  @IsString()
  address!: string;

  @ApiProperty({ example: 'Подозрение на спонсорство терроризма' })
  @IsString()
  reason!: string;
}

export class UpdateAmlSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  api?: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsUrl({}, { each: true })
  urls!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fileName?: string;

  @ApiProperty({ enum: AML_SOURCE_TYPES, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(AML_SOURCE_TYPES, { each: true })
  activeSources!: AmlSourceType[];

  @ApiProperty({ type: [AmlWalletRuleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AmlWalletRuleDto)
  fileRules!: AmlWalletRuleDto[];

  @ApiProperty({ example: 'Приказ №201, от 31.07.2026' })
  @IsString()
  comment!: string;
}
