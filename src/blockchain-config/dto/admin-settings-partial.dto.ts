import { IsOptional, IsString } from 'class-validator';

export class AdminSettingsPartialDto {
  @IsOptional()
  @IsString()
  esom_per_usd?: string;

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

  @IsOptional()
  @IsString()
  rates_change_reasons_json?: string;

  @IsOptional()
  @IsString()
  bank_fee_posting_time_bishkek?: string;

  @IsOptional()
  @IsString()
  central_bank_som_account?: string;

  @IsOptional()
  @IsString()
  central_bank_salam_wallet?: string;

  @IsOptional()
  @IsString()
  central_bank_usdt_wallet?: string;

  @IsOptional()
  @IsString()
  bank_som_account?: string;

  @IsOptional()
  @IsString()
  bank_salam_wallet?: string;

  @IsOptional()
  @IsString()
  bank_usdt_wallet?: string;

  @IsOptional()
  @IsString()
  bank_commission_partners_json?: string;
}
