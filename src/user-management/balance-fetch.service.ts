import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, Asset } from '@prisma/client';
import { EthereumService } from '../config/ethereum/ethereum.service';
import { TronService } from '../config/crypto/tron.service';
import { ShkeeperWalletService } from '../config/exchange/shkeeper-wallet.service';
import { BalanceCacheService } from './balance-cache.service';

@Injectable()
export class BalanceFetchService {
  private readonly logger = new Logger(BalanceFetchService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly eth: EthereumService,
    private readonly tron: TronService,
    private readonly shkeeperWallets: ShkeeperWalletService,
    private readonly balanceCache: BalanceCacheService,
  ) {}

  private resolveEthereumAddress(customer: { address?: string | null; private_key?: string | null }): string {
    const storedAddress = (customer.address || '').trim();
    if (!customer.private_key) {
      return storedAddress;
    }

    const signerAddress = this.eth.getAddressFromPrivateKey(customer.private_key);
    if (!storedAddress) {
      return signerAddress;
    }

    if (storedAddress.toLowerCase() !== signerAddress.toLowerCase()) {
      return signerAddress;
    }

    return storedAddress;
  }

  async refreshAllBalancesForUser(customer_id: number, assets?: Asset[]): Promise<void> {
    const customer = await this.prisma.customer.findUnique({ where: { customer_id } });
    if (!customer) return;

    const ethereumAddress = this.resolveEthereumAddress(customer);
    if (ethereumAddress && customer.address !== ethereumAddress) {
      await this.prisma.customer.update({
        where: { customer_id },
        data: { address: ethereumAddress },
      });
      customer.address = ethereumAddress;
    }

    const allow = (a: Asset) => !assets || assets.includes(a);

    // ESOM (ERC-20)
    if (allow('ESOM')) {
      try {
        const esom = await this.eth.getEsomBalance(ethereumAddress || customer.address);
        await this.upsertBalance(customer_id, 'ESOM', esom);
      } catch (e) {
        this.logger.warn(`ESOM balance fetch failed for ${customer_id}: ${e}`);
      }
    }

    // TRON USDT (TRC-20)
    if (allow('USDT_TRC20')) {
      try {
        const shkeeperWallet = await this.shkeeperWallets.ensureUsdtWallet(customer_id);
        const tronAddress = shkeeperWallet.address;
        if (!tronAddress) {
          throw new Error('SHKeeper wallet address is empty');
        }
        const usdtContract = process.env.TRON_USDT_CONTRACT || 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj'; // Mainnet USDT contract
        const usdt = await this.tron.getTrc20Balance(tronAddress, usdtContract);
        await this.upsertBalance(customer_id, 'USDT_TRC20', usdt);
      } catch (e) {
        this.logger.warn(`USDT_TRC20 balance fetch failed for ${customer_id}: ${e}`);
      }
    }

    this.balanceCache.invalidate(customer_id);

    // SOM fiat is stored in the external system; if a local cache exists, skip it.
  }

  private async upsertBalance(customer_id: number, asset: Asset, amt: number) {
    await this.prisma.userAssetBalance.upsert({
      where: { customer_id_asset: { customer_id, asset } },
      create: { customer_id, asset, balance: amt.toString() },
      update: { balance: amt.toString() },
    });
  }
}
