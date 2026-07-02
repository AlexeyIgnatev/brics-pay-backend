import { ApiProperty } from '@nestjs/swagger';

export class SettingsDto {
  @ApiProperty() esom_per_usd: string;
  @ApiProperty() esom_som_conversion_fee_pct: string;
  @ApiProperty() esom_som_conversion_fee_min: string;
  @ApiProperty() usdt_trade_fee_pct: string;
  @ApiProperty() usdt_withdraw_fee_fixed: string;
  @ApiProperty() min_withdraw_usdt_trc20: string;
}
