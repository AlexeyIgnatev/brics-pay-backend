import { ApiProperty } from '@nestjs/swagger';

export class AdminSettingsDto {
  @ApiProperty() esom_per_usd: string;
  @ApiProperty() esom_som_conversion_fee_pct: string;
  @ApiProperty() esom_som_conversion_fee_min: string;
  @ApiProperty() usdt_trade_fee_pct: string;
  @ApiProperty() usdt_withdraw_fee_fixed: string;
  @ApiProperty() min_withdraw_usdt_trc20: string;
  @ApiProperty() rates_change_reasons_json: string;
  @ApiProperty() bank_fee_posting_time_bishkek: string;
  @ApiProperty() central_bank_som_account: string;
  @ApiProperty() central_bank_salam_wallet: string;
  @ApiProperty() central_bank_usdt_wallet: string;
  @ApiProperty() bank_som_account: string;
  @ApiProperty() bank_salam_wallet: string;
  @ApiProperty() bank_usdt_wallet: string;
  @ApiProperty() bank_commission_partners_json: string;
}
