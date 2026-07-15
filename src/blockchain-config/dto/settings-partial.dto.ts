import { IsOptional, IsString } from 'class-validator';

export class SettingsPartialDto {
  @IsOptional()
  @IsString()
  esom_per_usd?: string;

  @IsOptional()
  @IsString()
  usd_buy_rate?: string;

  @IsOptional()
  @IsString()
  usd_sell_rate?: string;

  @IsOptional()
  @IsString()
  esom_som_conversion_fee_pct?: string;
  @IsOptional()
  @IsString()
  esom_som_conversion_fee_min?: string;

  @IsOptional()
  @IsString()
  usdt_trade_fee_pct?: string;

  @IsOptional()
  @IsString()
  usdt_withdraw_fee_fixed?: string;

  @IsOptional()
  @IsString()
  min_withdraw_usdt_trc20?: string;
}
