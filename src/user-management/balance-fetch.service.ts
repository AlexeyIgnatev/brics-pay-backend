import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, Asset } from '@prisma/client';
import { EthereumService } from '../config/ethereum/ethereum.service';
import { CryptoService } from '../config/crypto/crypto.service';
import { TronService } from '../config/crypto/tron.service';
import { BitcoinService } from '../config/crypto/bitcoin.service';

@Injectable()
export class BalanceFetchService {
  private readonly logger = new Logger(BalanceFetchService.name);
  constructor(
    private readonly prisma: PrismaClient,
    private readonly eth: EthereumService,
    private readonly crypto: CryptoService,
    private readonly tron: TronService,
    private readonly btc: BitcoinService,
  ) {}

  async refreshAllBalancesForUser(customer_id: number): Promise<void> {
    const customer = await this.prisma.customer.findUnique({ where: { customer_id } });
    if (!customer) return;

    // ESOM (ERC-20)
    try {
      const esom = await this.eth.getEsomBalance(customer.address);
      await this.upsertBalance(customer_id, 'ESOM', esom);
    } catch (e) {
      this.logger.warn(`ESOM balance fetch failed for ${customer_id}: ${e}`);
    }

    // ETH native
    try {
      const ethAddress = this.crypto.ethAddressFromPrivateKey(customer.private_key);
      const ethBal = await this.eth.getEthBalance(ethAddress);
      await this.upsertBalance(customer_id, 'ETH', ethBal);
    } catch (e) {
      this.logger.warn(`ETH balance fetch failed for ${customer_id}: ${e}`);
    }

    // TRON USDT (TRC-20)
    try {
      const tronAddress = this.crypto.trxAddressFromPrivateKey(customer.private_key);
      const usdtContract = process.env.TRON_USDT_CONTRACT || 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj'; // Mainnet USDT contract
      const usdt = await this.tron.getTrc20Balance(tronAddress, usdtContract);
      await this.upsertBalance(customer_id, 'USDT_TRC20', usdt);
    } catch (e) {
      this.logger.warn(`USDT_TRC20 balance fetch failed for ${customer_id}: ${e}`);
    }

    // BTC
    try {
      const btcAddress = this.crypto.btcBech32AddressFromPrivateKey(customer.private_key);
      const btcBal = await this.btc.getBtcBalance(btcAddress);
      await this.upsertBalance(customer_id, 'BTC', btcBal);
    } catch (e) {
      this.logger.warn(`BTC balance fetch failed for ${customer_id}: ${e}`);
    }

    // SOM фиат хранится во внешней системе; если у нас есть локальный кеш — пропускаем
  }

  private async upsertBalance(customer_id: number, asset: Asset, amt: number) {
    await this.prisma.userAssetBalance.upsert({
      where: { customer_id_asset: { customer_id, asset } },
      create: { customer_id, asset, balance: amt.toString() },
      update: { balance: amt.toString() },
    });
  }
}
