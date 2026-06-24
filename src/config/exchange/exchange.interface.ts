import { Asset } from '@prisma/client';

export interface MarketOrderResult {
  asset: Asset;
  amount_asset: string;
  price_usd: string;
  notional_usdt: string;
}

export interface IExchangeService {
  getUsdPrices(assets: Asset[]): Promise<Record<string, string>>;
  marketBuy(asset: Asset, usdtAmount: string): Promise<MarketOrderResult>;
  marketSell(asset: Asset, assetAmount: string): Promise<MarketOrderResult>;
  withdraw(asset: Asset, address: string, amount: string): Promise<{ txid: string }>;
}
