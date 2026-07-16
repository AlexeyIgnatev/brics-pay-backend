import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, Asset } from '@prisma/client';
import { EthereumService } from '../config/ethereum/ethereum.service';
import { CryptoService } from '../config/crypto/crypto.service';
import { TronService } from '../config/crypto/tron.service';
import { BalanceCacheService } from './balance-cache.service';

@Injectable()
export class BalanceFetchService {
  private readonly logger = new Logger(BalanceFetchService.name);
  constructor(
    private readonly prisma: PrismaClient,
    private readonly eth: EthereumService,
    private readonly crypto: CryptoService,
    private readonly tron: TronService,
    private readonly balanceCache: BalanceCacheService,
  ) {}

  private isBrowserWallet(customer: {
    customer_id: number;
    first_name?: string | null;
    middle_name?: string | null;
    last_name?: string | null;
  }): boolean {
    return (
      customer.customer_id >= 910_000_000 ||
      (customer.first_name?.trim() === 'Browser' &&
        customer.middle_name?.trim() === 'TRON' &&
        customer.last_name?.trim() === 'Wallet')
    );
  }

  async refreshAllBalancesForUser(
    customer_id: number,
    assets?: Asset[],
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { customer_id },
    });
    if (!customer) return;
    const browserWallet = this.isBrowserWallet(customer);

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
      if (browserWallet) {
        this.logger.verbose(
          `[balance-refresh] USDT skip browser-wallet customer=${customer_id} address=${customer.address}`,
        );
      } else {
      try {
        this.logger.verbose(
          `[balance-refresh] USDT lookup start customer=${customer_id} address=${customer.address} hasPrivateKey=${Boolean(customer.private_key)}`,
        );
        const tronAddress = this.crypto.trxAddressFromPrivateKey(
          customer.private_key,
        );
        const usdtContract =
          process.env.TRON_USDT_CONTRACT ||
          'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';
        this.logger.verbose(
          `[balance-refresh] USDT lookup request customer=${customer_id} tronAddress=${tronAddress} contract=${usdtContract}`,
        );
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
    }
    this.logger.verbose(`[balance-refresh] done customer=${customer_id}`);
  }

  private async upsertBalance(customer_id: number, asset: Asset, amt: number) {
    await this.prisma.userAssetBalance.upsert({
      where: { customer_id_asset: { customer_id, asset } },
      create: { customer_id, asset, balance: amt.toString() },
      update: { balance: amt.toString() },
    });
    this.balanceCache.invalidate(customer_id);
  }
}
