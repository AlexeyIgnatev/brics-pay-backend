import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, Asset } from '@prisma/client';
import { EthereumService } from '../config/ethereum/ethereum.service';
import { CryptoService } from '../config/crypto/crypto.service';
import { TronService } from '../config/crypto/tron.service';

@Injectable()
export class BalanceFetchService {
  private readonly logger = new Logger(BalanceFetchService.name);
  constructor(
    private readonly prisma: PrismaClient,
    private readonly eth: EthereumService,
    private readonly crypto: CryptoService,
    private readonly tron: TronService,
  ) {}

  async refreshAllBalancesForUser(
    customer_id: number,
    assets?: Asset[],
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { customer_id },
    });
    if (!customer) return;

    const allow = (a: Asset) => !assets || assets.includes(a);
    this.logger.verbose(
      `[balance-refresh] start customer=${customer_id} assets=${assets?.join(',') ?? 'all'} address=${customer.address}`,
    );

    if (allow('ESOM')) {
      try {
        const esom = await this.eth.getEsomBalance(customer.address);
        await this.upsertBalance(customer_id, 'ESOM', esom);
        this.logger.verbose(
          `[balance-refresh] ESOM updated customer=${customer_id} balance=${esom}`,
        );
      } catch (e) {
        this.logger.warn(`ESOM balance fetch failed for ${customer_id}: ${e}`);
      }
    }

    if (allow('USDT_TRC20')) {
      try {
        const tronAddress = this.crypto.trxAddressFromPrivateKey(
          customer.private_key,
        );
        const usdtContract =
          process.env.TRON_USDT_CONTRACT ||
          'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';
        const usdt = await this.tron.getTrc20Balance(tronAddress, usdtContract);
        await this.upsertBalance(customer_id, 'USDT_TRC20', usdt);
        this.logger.verbose(
          `[balance-refresh] USDT_TRC20 updated customer=${customer_id} tronAddress=${tronAddress} balance=${usdt}`,
        );
      } catch (e) {
        this.logger.warn(
          `USDT_TRC20 balance fetch failed for ${customer_id}: ${e}`,
        );
      }
    }
    this.logger.verbose(`[balance-refresh] done customer=${customer_id}`);
  }

  private async upsertBalance(customer_id: number, asset: Asset, amt: number) {
    await this.prisma.userAssetBalance.upsert({
      where: { customer_id_asset: { customer_id, asset } },
      create: { customer_id, asset, balance: amt.toString() },
      update: { balance: amt.toString() },
    });
  }
}
