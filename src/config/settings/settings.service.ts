import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { SettingsPartialDto } from '../../blockchain-config/dto/settings-partial.dto';
import { SettingsDto } from '../../blockchain-config/dto/settings.dto';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaClient) {
  }

  async get(): Promise<SettingsDto> {
    let s = await this.prisma.settings.findUnique({ where: { id: 1 } });
    if (!s) {
      s = await this.prisma.settings.create({
        data: {
          id: 1,
          esom_per_usd: '1',
          esom_som_conversion_fee_pct: '0',
          btc_trade_fee_pct: '0.5',
          eth_trade_fee_pct: '0.5',
          usdt_trade_fee_pct: '0.2',
          btc_withdraw_fee_fixed: '0.0002',
          eth_withdraw_fee_fixed: '0.003',
          usdt_withdraw_fee_fixed: '10',
          min_withdraw_btc: '0.0002',
          min_withdraw_eth: '0.003',
          min_withdraw_usdt_trc20: '10',
        },
      });
    }

    return this.mapToDto(s);
  }

  async update(partial: SettingsPartialDto): Promise<SettingsDto> {
    await this.get();

    this.logger.debug(`Update settings ${JSON.stringify(partial, null, 2)}`);
    const s = await this.prisma.settings.update({
      where: { id: 1 },
      data: partial,
    });

    return this.mapToDto(s);
  }

  mapToDto(s: any): SettingsDto {
    return {
      esom_per_usd: s.esom_per_usd.toString(),
      esom_som_conversion_fee_pct: s.esom_som_conversion_fee_pct.toString(),
      btc_trade_fee_pct: s.btc_trade_fee_pct.toString(),
      eth_trade_fee_pct: s.eth_trade_fee_pct.toString(),
      usdt_trade_fee_pct: s.usdt_trade_fee_pct.toString(),
      btc_withdraw_fee_fixed: s.btc_withdraw_fee_fixed.toString(),
      eth_withdraw_fee_fixed: s.eth_withdraw_fee_fixed.toString(),
      usdt_withdraw_fee_fixed: s.usdt_withdraw_fee_fixed.toString(),
      min_withdraw_btc: s.min_withdraw_btc.toString(),
      min_withdraw_eth: s.min_withdraw_eth.toString(),
      min_withdraw_usdt_trc20: s.min_withdraw_usdt_trc20.toString(),
    };
  }
}
