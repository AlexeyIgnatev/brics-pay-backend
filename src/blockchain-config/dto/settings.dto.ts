import { ApiProperty } from '@nestjs/swagger';

export class SettingsDto {
  @ApiProperty() esom_per_usd: string;
  @ApiProperty() esom_som_conversion_fee_pct: string;

  @ApiProperty() btc_trade_fee_pct: string;
  @ApiProperty() eth_trade_fee_pct: string;
  @ApiProperty() usdt_trade_fee_pct: string;

  @ApiProperty() btc_withdraw_fee_fixed: string;
  @ApiProperty() eth_withdraw_fee_fixed: string;
  @ApiProperty() usdt_withdraw_fee_fixed: string;

  @ApiProperty() min_withdraw_btc: string;
  @ApiProperty() min_withdraw_eth: string;
  @ApiProperty() min_withdraw_usdt_trc20: string;
}
