import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { Asset } from '@prisma/client';
import { IExchangeService, MarketOrderResult } from './exchange.interface';

@Injectable()
export class BybitExchangeService implements IExchangeService {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private readonly http: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('BYBIT_API_KEY')!;
    this.apiSecret = this.config.get<string>('BYBIT_API_SECRET')!;
    this.baseUrl =
      this.config.get<string>('BYBIT_BASE_URL') || 'https://api.bybit.com';
    this.http = axios.create({ baseURL: this.baseUrl, timeout: 10000 });
  }

  private sign(params: Record<string, unknown>): {
    headers: Record<string, string>;
    payload: string;
  } {
    const timestamp = Date.now().toString();
    const recvWindow = '30000';
    const query = JSON.stringify(params ?? {});
    const payload = timestamp + this.apiKey + recvWindow + query;
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(payload)
      .digest('hex');

    return {
      headers: {
        'X-BAPI-SIGN': signature,
        'X-BAPI-API-KEY': this.apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'X-BAPI-SIGN-TYPE': '2',
        'Content-Type': 'application/json',
      },
      payload: query,
    };
  }

  private unsupportedAsset(asset: Asset): never {
    throw new BadRequestException(`Unsupported asset ${asset}`);
  }

  private bybitErrorMessage(operation: 'withdraw', retMsg?: string): string {
    const msg = retMsg || 'Unknown error';

    if (/insufficient/i.test(msg)) {
      return 'Недостаточно средств для вывода с учетом комиссии';
    }
    if (/permission denied|api key permissions/i.test(msg)) {
      return 'Нет разрешения на выполнение операции. Проверьте права API-ключа Bybit';
    }
    if (/minimum|min|too low|below/i.test(msg)) {
      return 'Сумма меньше минимально допустимой';
    }
    if (/address|whitelist/i.test(msg)) {
      return 'Адрес получателя не разрешен для вывода';
    }

    return `Ошибка биржи Bybit: ${msg}`;
  }

  async getUsdPrices(assets: Asset[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    for (const asset of assets) {
      if (asset !== 'USDT_TRC20') {
        this.unsupportedAsset(asset);
      }
      result[asset] = '1';
    }

    return result;
  }

  async marketBuy(
    asset: Asset,
    usdtAmount: string,
  ): Promise<MarketOrderResult> {
    if (asset !== 'USDT_TRC20') {
      this.unsupportedAsset(asset);
    }

    return {
      asset,
      amount_asset: usdtAmount,
      price_usd: '1',
      notional_usdt: usdtAmount,
    };
  }

  async marketSell(
    asset: Asset,
    assetAmount: string,
  ): Promise<MarketOrderResult> {
    if (asset !== 'USDT_TRC20') {
      this.unsupportedAsset(asset);
    }

    return {
      asset,
      amount_asset: assetAmount,
      price_usd: '1',
      notional_usdt: assetAmount,
    };
  }

  async withdraw(
    asset: Asset,
    address: string,
    amount: string,
  ): Promise<{ txid: string }> {
    if (asset !== 'USDT_TRC20') {
      this.unsupportedAsset(asset);
    }

    const params = {
      coin: 'USDT',
      chain: 'TRX',
      address,
      amount,
    };
    const { headers, payload } = this.sign(params);
    const { data } = await this.http.post(
      '/v5/asset/withdraw/create',
      payload,
      { headers },
    );

    if (data.retCode !== 0) {
      throw new BadRequestException(
        this.bybitErrorMessage('withdraw', data.retMsg),
      );
    }

    const txid = data?.result?.id?.toString() ?? '';
    return { txid };
  }
}
