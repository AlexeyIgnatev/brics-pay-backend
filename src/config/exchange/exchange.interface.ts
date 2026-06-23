import { Asset } from '@prisma/client';

export interface IExchangeService {
  getUsdPrices(assets: Asset[]): Promise<Record<string, string>>;
  createPaymentRequest(
    params: {
      asset: Asset;
      externalId: string;
      fiat: string;
      amount: string;
      callbackUrl?: string;
    },
  ): Promise<{
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
  }>;
  withdraw(
    asset: Asset,
    address: string,
    amount: string,
    options?: { externalId?: string; callbackUrl?: string; fee?: string },
  ): Promise<{ txid: string }>;
}
