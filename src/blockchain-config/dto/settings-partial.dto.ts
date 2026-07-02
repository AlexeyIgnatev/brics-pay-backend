import { IsString } from 'class-validator';

export class SettingsPartialDto {
  @IsString() esom_per_usd?: string;

  @IsString() esom_som_conversion_fee_pct?: string;
  @IsString() esom_som_conversion_fee_min?: string;

  @IsString() usdt_trade_fee_pct?: string;

  @IsString() usdt_withdraw_fee_fixed?: string;

  @IsString() min_withdraw_usdt_trc20?: string;
}
