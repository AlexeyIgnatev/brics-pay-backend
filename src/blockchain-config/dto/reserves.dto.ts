import { ApiProperty } from '@nestjs/swagger';

export class TreasuryReservesDto {
  @ApiProperty() treasury_address: string;
  @ApiProperty() usdt_balance: number;
  @ApiProperty() trx_balance: number;
  @ApiProperty() energy_available: number;
  @ApiProperty() bandwidth_available: number;
  @ApiProperty() energy_spent_today: number;
  @ApiProperty() energy_spent_total: number;
  @ApiProperty() bandwidth_spent_today: number;
  @ApiProperty() bandwidth_spent_total: number;
  @ApiProperty() network_fee_trx_today: number;
  @ApiProperty() network_fee_trx_total: number;
}
