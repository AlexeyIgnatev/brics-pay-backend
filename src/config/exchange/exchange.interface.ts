import { Asset } from '@prisma/client';

export interface MarketOrderResult {
  asset: Asset;
  amount_asset: string; // Decimal string
  price_usd: string;    // avg price in USD
  notional_usdt: string;// executed USDT value
}

export interface IExchangeService {
  getUsdPrices(assets: Asset[]): Promise<Record<string, string>>; // asset -> price USD (decimal string)
  marketBuy(asset: Asset, usdtAmount: string): Promise<MarketOrderResult>;
  marketSell(asset: Asset, assetAmount: string): Promise<MarketOrderResult>;
  withdraw(asset: Asset, address: string, amount: string): Promise<{ txid: string }>; // on-chain withdrawal
}
