import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, Settings } from '@prisma/client';
import { SettingsPartialDto } from '../../blockchain-config/dto/settings-partial.dto';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaClient) {
  }

  async get(): Promise<Settings> {
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
    return s;
  }

  async update(partial: SettingsPartialDto): Promise<Settings> {
    await this.get();

    this.logger.debug(`Update settings ${JSON.stringify(partial, null, 2)}`);
    return this.prisma.settings.update({
      where: { id: 1 },
      data: partial,
    });
  }
}
