import { ApiProperty } from '@nestjs/swagger';

export class BankCommissionBalanceSlotDto {
  @ApiProperty() reference: string;
  @ApiProperty() balance: number | null;
  @ApiProperty() asset: string;
  @ApiProperty() error: string | null;
}

export class BankCommissionGroupBalancesDto {
  @ApiProperty({ type: BankCommissionBalanceSlotDto, nullable: true })
  som_account: BankCommissionBalanceSlotDto | null;

  @ApiProperty({ type: BankCommissionBalanceSlotDto, nullable: true })
  salam_wallet: BankCommissionBalanceSlotDto | null;

  @ApiProperty({ type: BankCommissionBalanceSlotDto, nullable: true })
  usdt_wallet: BankCommissionBalanceSlotDto | null;
}

export class BankCommissionPartnerBalancesDto extends BankCommissionGroupBalancesDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
}

export class BankCommissionBalancesDto {
  @ApiProperty() posting_time_bishkek: string;
  @ApiProperty({ type: BankCommissionGroupBalancesDto })
  central_bank: BankCommissionGroupBalancesDto;
  @ApiProperty({ type: BankCommissionGroupBalancesDto })
  bank: BankCommissionGroupBalancesDto;
  @ApiProperty({ type: [BankCommissionPartnerBalancesDto] })
  partners: BankCommissionPartnerBalancesDto[];
}
