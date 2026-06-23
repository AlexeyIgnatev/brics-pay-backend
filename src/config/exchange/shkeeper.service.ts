import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { Asset } from '@prisma/client';
import { IExchangeService } from './exchange.interface';

type ShkeeperTaskResultItem = {
  dest?: string;
  amount?: string;
  status?: 'success' | 'error' | string;
  message?: string;
  txids?: string[];
};

type ShkeeperTaskResponse = {
  status?: 'PENDING' | 'SUCCESS' | 'error' | string;
  result?: ShkeeperTaskResultItem[] | null;
  message?: string;
  task_id?: string;
};

type ShkeeperPaymentRequestResponse = {
  status?: string;
  message?: string;
  id?: string | number;
  invoice_id?: string | number;
  request_id?: string | number;
  external_id?: string | number;
  address?: string;
  wallet?: string;
  payment_address?: string;
  fiat?: string;
  amount?: string;
  amount_fiat?: string;
};

@Injectable()
export class ShkeeperExchangeService implements IExchangeService {
  private readonly logger = new Logger(ShkeeperExchangeService.name);
  private readonly baseUrl: string;
  private readonly payoutCrypto: string;
  private readonly payoutUser: string;
  private readonly payoutPassword: string;
  private readonly webhookSecret: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly http: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('SHKEEPER_BASE_URL') || 'http://localhost:5000';
    this.payoutCrypto = this.config.get<string>('SHKEEPER_PAYOUT_CRYPTO') || 'USDT';
    this.payoutUser = this.config.get<string>('SHKEEPER_BASIC_USER') || this.config.get<string>('SHKEEPER_LOGIN') || 'admin';
    this.payoutPassword = this.config.get<string>('SHKEEPER_BASIC_PASSWORD') || this.config.get<string>('SHKEEPER_PASSWORD') || 'admin';
    this.webhookSecret = this.config.get<string>('SHKEEPER_API_KEY') || '';
    this.apiKey = this.config.get<string>('SHKEEPER_API_KEY') || '';
    this.timeoutMs = Number(this.config.get<string>('SHKEEPER_HTTP_TIMEOUT_MS') || 10000);
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeoutMs,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private basicAuthHeader(): string {
    return `Basic ${Buffer.from(`${this.payoutUser}:${this.payoutPassword}`).toString('base64')}`;
  }

  private describeError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data;
      return `axios status=${status ?? 'n/a'} message=${error.message} data=${typeof data === 'string' ? data : JSON.stringify(data)}`;
    }
    if (error instanceof Error) return error.message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  private async request<T>(method: 'get' | 'post', path: string, data?: unknown): Promise<T> {
    try {
      this.logger.debug(`SHKeeper request ${method.toUpperCase()} ${path}`);
      const res = method === 'get'
        ? await this.http.get<T>(path, { headers: { Authorization: this.basicAuthHeader() } })
        : await this.http.post<T>(path, data, { headers: { Authorization: this.basicAuthHeader() } });
      this.logger.debug(`SHKeeper response ${method.toUpperCase()} ${path} status=${res.status}`);
      return res.data;
    } catch (error) {
      this.logger.error(`SHKeeper request failed ${method.toUpperCase()} ${path}: ${this.describeError(error)}`);
      throw error;
    }
  }

  private async apiKeyRequest<T>(method: 'get' | 'post', path: string, data?: unknown): Promise<T> {
    if (!this.apiKey) {
      throw new BadRequestException('SHKEEPER_API_KEY is not configured');
    }

    try {
      this.logger.debug(`SHKeeper API key request ${method.toUpperCase()} ${path} payload=${JSON.stringify(data)}`);
      const headers = { 'X-Shkeeper-API-Key': this.apiKey };
      const res = method === 'get'
        ? await this.http.get<T>(path, { headers })
        : await this.http.post<T>(path, data, { headers });
      this.logger.debug(`SHKeeper API key response ${method.toUpperCase()} ${path} status=${res.status} body=${JSON.stringify(res.data)}`);
      return res.data;
    } catch (error) {
      this.logger.error(`SHKeeper API key request failed ${method.toUpperCase()} ${path}: ${this.describeError(error)}`);
      throw error;
    }
  }

  async getUsdPrices(assets: Asset[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const asset of assets) {
      if (asset !== 'USDT_TRC20') {
        throw new BadRequestException(`Unsupported asset price request: ${asset}`);
      }
      result[asset] = '1';
    }
    return result;
  }

  async createPaymentRequest(params: {
    asset: Asset;
    externalId: string;
    fiat: string;
    amount: string;
    callbackUrl?: string;
  }): Promise<ShkeeperPaymentRequestResponse> {
    if (params.asset !== 'USDT_TRC20') {
      throw new BadRequestException(`Unsupported payment request asset ${params.asset}`);
    }

    const payload: Record<string, unknown> = {
      external_id: params.externalId,
      fiat: params.fiat,
      amount: params.amount,
    };
    if (params.callbackUrl) {
      payload.callback_url = params.callbackUrl;
    }

    this.logger.log(`Creating SHKeeper payment request for externalId=${params.externalId} amount=${params.amount}`);
    return this.apiKeyRequest<ShkeeperPaymentRequestResponse>('post', `/api/v1/USDT/payment_request`, payload);
  }

  async createPayoutTask(params: {
    amount: string;
    destination: string;
    externalId: string;
    callbackUrl?: string;
    fee?: string;
  }): Promise<string> {
    const payload = {
      amount: params.amount,
      destination: params.destination,
      fee: params.fee ?? '0',
      callback_url: params.callbackUrl,
      external_id: params.externalId,
    };

    const response = await this.request<{ task_id?: string; status?: string; message?: string }>(
      'post',
      `/api/v1/${this.payoutCrypto}/payout`,
      payload,
    );

    if (!response?.task_id) {
      throw new BadRequestException(response?.message || 'SHKeeper payout request failed');
    }

    this.logger.log(`SHKeeper payout created: crypto=${this.payoutCrypto} externalId=${params.externalId} taskId=${response.task_id}`);
    return response.task_id;
  }

  async getPayoutTask(taskId: string): Promise<ShkeeperTaskResponse> {
    return this.request<ShkeeperTaskResponse>('get', `/api/v1/${this.payoutCrypto}/task/${taskId}`);
  }

  async withdraw(
    asset: Asset,
    address: string,
    amount: string,
    options?: { externalId?: string; callbackUrl?: string; fee?: string },
  ): Promise<{ txid: string }> {
    if (asset !== 'USDT_TRC20') {
      throw new BadRequestException(`Unsupported withdraw asset ${asset}`);
    }

    const externalId = options?.externalId || crypto.randomUUID();
    const taskId = await this.createPayoutTask({
      amount,
      destination: address,
      externalId,
      callbackUrl: options?.callbackUrl,
      fee: options?.fee,
    });

    return { txid: taskId };
  }

  verifyWebhookSignature(timestamp: string | undefined, signature: string | undefined, rawBody: Buffer | string): boolean {
    if (!timestamp || !signature || !this.webhookSecret) {
      return false;
    }

    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(Buffer.concat([Buffer.from(`${timestamp}.`), body]))
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const signatureBuf = Buffer.from(signature, 'utf8');
    if (expectedBuf.length !== signatureBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, signatureBuf);
  }
}
