import { UsersService } from './users.service';
import { BricsService } from 'src/config/brics/brics.service';
import { EthereumService } from 'src/config/ethereum/ethereum.service';
import { CryptoService } from 'src/config/crypto/crypto.service';
import { PrismaClient } from '@prisma/client';
import { SettingsService } from '../config/settings/settings.service';
import { BybitExchangeService } from '../config/exchange/bybit.service';

function createMock<T extends object>(spec: Partial<Record<keyof T, any>>): T {
  return spec as unknown as T;
}

describe('UsersService.getUserWallets rates', () => {
  it('computes ESOM-based buy/sell rates with fees', async () => {
    const prisma = createMock<PrismaClient>({
      customer: { findUniqueOrThrow: jest.fn().mockResolvedValue({ customer_id: 1, address: '0xabc', private_key: 'k', phone: '+1' }) },
      userAssetBalance: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any);

    const brics = createMock<BricsService>({ getSomBalance: jest.fn().mockResolvedValue(1000) });
    const eth = createMock<EthereumService>({ getEsomBalance: jest.fn().mockResolvedValue(500) });
    const crypto = createMock<CryptoService>({
      btcBech32AddressFromPrivateKey: () => 'bc1...',
      ethAddressFromPrivateKey: () => '0x...',
      trxAddressFromPrivateKey: () => 'T...',
    });
    const settings = createMock<SettingsService>({ get: jest.fn().mockResolvedValue({
      esom_per_usd: '12',
      btc_trade_fee_pct: '1', eth_trade_fee_pct: '2', usdt_trade_fee_pct: '0.5',
    } as any) });
    const exchange = createMock<BybitExchangeService>({ getUsdPrices: jest.fn().mockResolvedValue({ BTC: '60000', ETH: '3000', USDT_TRC20: '1' }) });

    const svc = new UsersService(brics, prisma, eth, crypto, settings, exchange);
    const wallets = await svc.getUserWallets({ customer_id: 1, phone: '+1', username: 'u' } as any);

    const btcBase = 60000 * 12; // 720k ESOM
    const btcBuy = btcBase * 1.01; // fee 1%
    const btcSell = btcBase * 0.99;
    expect(wallets.find(w => w.currency === 2 /* BTC enum index */)?.buy_rate).toBeCloseTo(btcBuy);
    expect(wallets.find(w => w.currency === 2 /* BTC enum index */)?.sell_rate).toBeCloseTo(btcSell);
  });
});
