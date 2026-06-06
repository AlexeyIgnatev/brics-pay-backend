import { ApiProperty } from '@nestjs/swagger';
import { CustomerResidency, TariffCategory, TariffOperation } from '@prisma/client';
import { IsArray, IsEnum, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class TariffSettingDto {
  @ApiProperty({ enum: TariffCategory }) category: TariffCategory;
  @ApiProperty({ enum: CustomerResidency }) residency: CustomerResidency;
  @ApiProperty({ enum: TariffOperation }) operation: TariffOperation;
  @ApiProperty() percent_fee: string;
  @ApiProperty() fixed_fee: string;
}

export class TariffSettingUpdateDto {
  @ApiProperty({ enum: TariffCategory }) @IsEnum(TariffCategory) category: TariffCategory;
  @ApiProperty({ enum: CustomerResidency }) @IsEnum(CustomerResidency) residency: CustomerResidency;
  @ApiProperty({ enum: TariffOperation }) @IsEnum(TariffOperation) operation: TariffOperation;
  @ApiProperty() @IsString() percent_fee: string;
  @ApiProperty() @IsString() fixed_fee: string;
}

export class TariffSettingsUpdateDto {
  @ApiProperty({ type: [TariffSettingUpdateDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TariffSettingUpdateDto)
  items: TariffSettingUpdateDto[];
}
