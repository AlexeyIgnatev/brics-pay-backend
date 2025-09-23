import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { Asset } from '@prisma/client';
import { IExchangeService, MarketOrderResult } from './exchange.interface';

@Injectable()
export class BybitExchangeService implements IExchangeService {
  private readonly logger = new Logger(BybitExchangeService.name);
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private readonly http: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('BYBIT_API_KEY')!;
    this.apiSecret = this.config.get<string>('BYBIT_API_SECRET')!;
    this.baseUrl = this.config.get<string>('BYBIT_BASE_URL') || 'https://api.bybit.com';
    this.http = axios.create({ baseURL: this.baseUrl, timeout: 10000 });
  }

  private sign(params: Record<string, any>): { headers: Record<string, string>; payload: string } {
    const timestamp = Date.now().toString();
    const recv_window = '5000';
    const query = JSON.stringify(params ?? {});
    const payload = timestamp + this.apiKey + recv_window + query;
    const signature = crypto.createHmac('sha256', this.apiSecret).update(payload).digest('hex');
    return {
      headers: {
        'X-BAPI-SIGN': signature,
        'X-BAPI-API-KEY': this.apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recv_window,
        'Content-Type': 'application/json',
      },
      payload: query,
    };
  }

  private spotSymbol(asset: Asset): string {
    switch (asset) {
      case 'BTC': return 'BTCUSDT';
      case 'ETH': return 'ETHUSDT';
      // USDT -> USD price is 1
      default:
        throw new Error(`Unsupported spot symbol for asset ${asset}`);
    }
  }

  async getUsdPrices(assets: Asset[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const a of assets) {
      if (a === 'USDT_TRC20') { result[a] = '1'; continue; }
      if (a === 'BTC' || a === 'ETH') {
        const symbol = this.spotSymbol(a);
        const { data } = await this.http.get(`/v5/market/tickers`, { params: { category: 'spot', symbol } });
        const tick = data?.result?.list?.[0];
        if (!tick) throw new Error(`No ticker for ${symbol}`);
        result[a] = tick.lastPrice ?? tick.ask1Price ?? tick.bid1Price ?? '0';
        continue;
      }
    }
    return result;
  }

  async marketBuy(asset: Asset, usdtAmount: string): Promise<MarketOrderResult> {
    if (asset === 'USDT_TRC20') {
      return { asset, amount_asset: usdtAmount, price_usd: '1', notional_usdt: usdtAmount };
    }
    const qtySide = 'Buy';
    const symbol = this.spotSymbol(asset);
    const params = {
      category: 'spot',
      symbol,
      side: qtySide,
      orderType: 'Market',
      qty: undefined,
      orderFilter: 'tpslOrder',
      marketUnit: 'quoteCoin',
      qty: usdtAmount,
    } as any;
    const { headers, payload } = this.sign(params);
    const { data } = await this.http.post('/v5/order/create', payload, { headers });
    if (data.retCode !== 0) throw new Error(`Bybit order error: ${data.retMsg}`);
    const price = await this.getUsdPrices([asset]);
    const p = price[asset];
    const amount = (Number(usdtAmount) / Number(p)).toString();
    return { asset, amount_asset: amount, price_usd: p, notional_usdt: usdtAmount };
  }

  async marketSell(asset: Asset, assetAmount: string): Promise<MarketOrderResult> {
    if (asset === 'USDT_TRC20') {
      return { asset, amount_asset: assetAmount, price_usd: '1', notional_usdt: assetAmount };
    }
    const qtySide = 'Sell';
    const symbol = this.spotSymbol(asset);
    const params = {
      category: 'spot',
      symbol,
      side: qtySide,
      orderType: 'Market',
      qty: assetAmount,
    };
    const { headers, payload } = this.sign(params);
    const { data } = await this.http.post('/v5/order/create', payload, { headers });
    if (data.retCode !== 0) throw new Error(`Bybit order error: ${data.retMsg}`);
    const price = await this.getUsdPrices([asset]);
    const p = price[asset];
    const notional = (Number(assetAmount) * Number(p)).toString();
    return { asset, amount_asset: assetAmount, price_usd: p, notional_usdt: notional };
  }

  async withdraw(asset: Asset, address: string, amount: string): Promise<{ txid: string }> {
    // Bybit withdraw v5 requires coin and chain
    let coin = '';
    let chain = '';
    if (asset === 'BTC') { coin = 'BTC'; chain = 'BTC'; }
    else if (asset === 'ETH') { coin = 'ETH'; chain = 'ETH'; }
    else if (asset === 'USDT_TRC20') { coin = 'USDT'; chain = 'TRX'; }
    else throw new Error(`Unsupported withdraw asset ${asset}`);

    const params = { coin, chain, address, amount };
    const { headers, payload } = this.sign(params);
    const { data } = await this.http.post('/v5/asset/withdraw/create', payload, { headers });
    if (data.retCode !== 0) throw new Error(`Bybit withdraw error: ${data.retMsg}`);
    const txid = data?.result?.id?.toString() ?? '';
    return { txid };
  }
}
