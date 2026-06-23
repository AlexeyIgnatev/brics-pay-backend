import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { ShkeeperExchangeService } from './shkeeper.service';

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
};

type CustomerWallet = {
  customer_id: number;
  address: string;
  created: boolean;
};

@Injectable()
export class ShkeeperWalletService {
  private readonly logger = new Logger(ShkeeperWalletService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly exchange: ShkeeperExchangeService,
    private readonly config: ConfigService,
  ) {}

  private normalizeAddress(value?: string | null): string {
    return (value || '').trim();
  }

  private buildExternalId(customerId: number): string {
    return `customer:${customerId}`;
  }

  async ensureUsdtWallet(customerId: number): Promise<CustomerWallet> {
    const customer = await this.prisma.customer.findUnique({
      where: { customer_id: customerId },
      select: { customer_id: true, address: true },
    });
    const existingWallet = await this.prisma.userAssetBalance.findUnique({
      where: {
        customer_id_asset: {
          customer_id: customerId,
          asset: 'USDT_TRC20',
        },
      },
      select: { balance: true },
    });

    if (!customer) {
      throw new Error(`Customer ${customerId} not found`);
    }

    this.logger.log(`ensureUsdtWallet start customer=${customerId} currentAddress=${customer.address || '<empty>'}`);

    const payload = {
      asset: 'USDT_TRC20' as const,
      externalId: this.buildExternalId(customerId),
      fiat: 'USD',
      amount: '0',
      callbackUrl: this.config.get<string>('SHKEEPER_CALLBACK_URL') || 'http://192.168.255.121:8000/shkeeper/webhook',
    };
    this.logger.log(`ensureUsdtWallet requesting SHKeeper payment_request customer=${customerId} externalId=${payload.externalId}`);

    let response: ShkeeperPaymentRequestResponse;
    try {
      response = await this.exchange.createPaymentRequest(payload) as ShkeeperPaymentRequestResponse;
    } catch (error) {
      this.logger.error(`ensureUsdtWallet SHKeeper request failed customer=${customerId}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }

    this.logger.log(
      `ensureUsdtWallet SHKeeper response customer=${customerId} ` +
      `status=${response.status ?? '<empty>'} id=${response.id ?? response.invoice_id ?? response.request_id ?? '<empty>'} ` +
      `externalId=${response.external_id ?? '<empty>'} address=${response.address ?? '<empty>'} wallet=${response.wallet ?? '<empty>'} paymentAddress=${response.payment_address ?? '<empty>'}`,
    );

    const address = this.normalizeAddress(response.address || response.wallet || response.payment_address);
    if (!address) {
      this.logger.error(`ensureUsdtWallet missing address in SHKeeper response customer=${customerId} raw=${JSON.stringify(response)}`);
      throw new Error(`SHKeeper did not return a wallet address for customer=${customerId}`);
    }

    const created = !existingWallet;

    this.logger.log(`Ensured SHKeeper wallet for customer=${customerId} address=${address}`);
    return { customer_id: customerId, address, created };
  }

  async getUsdtWallet(customerId: number): Promise<CustomerWallet | null> {
    const customer = await this.prisma.customer.findUnique({
      where: { customer_id: customerId },
      select: { customer_id: true, address: true },
    });
    if (!customer) return null;
    return this.ensureUsdtWallet(customer.customer_id);
  }

  async findCustomerByAddress(address: string): Promise<CustomerWallet | null> {
    const target = this.normalizeAddress(address);
    if (!target) return null;

    const customer = await this.prisma.customer.findFirst({
      where: { address: target },
      select: { customer_id: true, address: true },
    });
    if (!customer) return null;
    return { customer_id: customer.customer_id, address: customer.address, created: false };
  }
}
