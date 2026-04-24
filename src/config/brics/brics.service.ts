import { BadRequestException, Injectable, Logger, Scope, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { BricsAccountDto, BricsCustomerDto } from './dto/brics.dto';
import * as https from 'node:https';

@Injectable({ scope: Scope.REQUEST })
export class BricsService {
  private readonly BRICS_API_ROOT: string;
  private readonly INTEGRATION_API_ROOT: string;
  private readonly CT_ACCOUNT_NO: string;
  private readonly axiosInstance: AxiosInstance;
  private readonly logger = new Logger(BricsService.name);
  private cookies: string = '';

  constructor(private readonly configService: ConfigService) {
    this.BRICS_API_ROOT = this.configService.get<string>('BRICS_API_ROOT')!;
    this.INTEGRATION_API_ROOT = this.configService.get<string>('INTEGRATION_API_ROOT')!;
    this.CT_ACCOUNT_NO = this.configService.get<string>('CT_ACCOUNT_NO')!;

    this.axiosInstance = axios.create({
      withCredentials: true,
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
      }),
    });
  }

  private updateCookies(setCookieHeaders?: string[]) {
    if (!setCookieHeaders) return;

    // Разбираем новые куки
    const newCookies = setCookieHeaders.map(
      (cookieString) => cookieString.split(';')[0],
    ); // Берём только "ключ=значение"

    // Если уже были куки, добавляем новые
    const existingCookies = this.cookies
      ? this.cookies.split('; ').reduce(
        (acc, cookie) => {
          const [key, value] = cookie.split('=');
          acc[key] = value;
          return acc;
        },
        {} as Record<string, string>,
      )
      : {};

    // Обновляем существующие куки новыми
    newCookies.forEach((cookie) => {
      const [key, value] = cookie.split('=');
      existingCookies[key] = value;
    });

    // Сохраняем обновлённую строку кук
    this.cookies = Object.entries(existingCookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  private extractBricsErrorMessage(data: unknown): string | null {
    if (data == null) return null;

    if (typeof data === 'string') {
      const text = data.trim();
      if (!text) return null;

      if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
        try {
          const $ = cheerio.load(text);
          const alertText = $('.alert__body p').first().text().trim()
            || $('.alert_type_error .alert__body').first().text().trim()
            || $('title').first().text().trim();
          if (alertText) return alertText.replace(/\s+/g, ' ').trim();
        } catch {
          // ignore parser failure and fallback below
        }
      }

      return text.replace(/\s+/g, ' ').trim().slice(0, 300);
    }

    if (typeof data === 'object') {
      const anyData = data as any;
      const message = anyData?.message || anyData?.error || anyData?.title;
      if (typeof message === 'string' && message.trim()) return message.trim();

      try {
        return JSON.stringify(data).slice(0, 300);
      } catch {
        return null;
      }
    }

    return String(data);
  }

  private extractBricsPageAlert(html: unknown): string | null {
    if (typeof html !== 'string') return null;
    const text = html.trim();
    if (!text.includes('<html')) return null;

    try {
      const $ = cheerio.load(text);
      const alertText = $('.alert.alert_type_error .alert__body p').first().text().trim()
        || $('.alert_type_error .alert__body p').first().text().trim()
        || $('.alert.alert_type_error .alert__body').first().text().trim();
      return alertText ? alertText.replace(/\s+/g, ' ').trim() : null;
    } catch {
      return null;
    }
  }

  private throwBricsRequestError(action: string, error: unknown): void {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const extractedMessage = this.extractBricsErrorMessage(error.response?.data);

      const details = [
        `ABS ${action} failed`,
        status != null ? `status=${status}` : null,
        extractedMessage ? `message=${extractedMessage}` : null,
      ].filter(Boolean).join(', ');

      this.logger.error(details);
      throw new BadRequestException(details);
    }

    throw error;
  }

  private isInvalidUri1023Error(message: string | null): boolean {
    if (!message) return false;
    return /\b1023\b/.test(message) && /недопустимый uri/i.test(message);
  }

  private buildSafeAsciiComment(originalComment: string): string {
    const txRefMatch = originalComment.match(/ABS-\d+/i);
    const txRef = txRefMatch?.[0] ?? `ABS-${Date.now()}`;
    return `ABS transfer ${txRef}`;
  }

  private async sendCreateTransferRequest(
    token: string,
    transactionBody: {
      InternalOperationType: number;
      OperationID: number;
      DtAccountNo: string;
      CtAccountNo: string;
      CurrencyID: number;
      Sum: number;
      Comment: string;
      IsTemplate: boolean;
      Schedule: null;
    },
  ) {
    this.logger.verbose(
      'Send createTransfer request',
      transactionBody,
    );

    const response = await this.axiosInstance.post(
      this.buildBricsUrl('/ru-RU/Accounts/InternalTransaction'),
      transactionBody,
      {
        withCredentials: true,
        headers: {
          __requestverificationtoken: token,
          Cookie: this.cookies != null ? this.cookies : undefined,
        },
      },
    );

    this.updateCookies(response.headers['set-cookie']);

    this.logger.verbose(
      `Received createTransfer response ${response.status} ${JSON.stringify(response.data)}`,
    );

    return response;
  }

  private buildBricsUrl(path: string): string {
    const normalizedRoot = this.BRICS_API_ROOT.replace(/\/+$/, '');
    const rootWithInternetBanking = /\/InternetBanking$/i.test(normalizedRoot)
      ? normalizedRoot
      : `${normalizedRoot}/InternetBanking`;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${rootWithInternetBanking}${normalizedPath}`;
  }

  private async getRequestVerificationToken(html: string): Promise<string> {
    const $ = cheerio.load(html);
    const token = $('input[name="__RequestVerificationToken"]').val();
    if (!token) {
      this.logger.error('Токен не найден в ответе');
      throw new BadRequestException('Токен не найден в ответе');
    }
    this.logger.verbose(`Parsed RequestVerificationToken ${token}`);
    return token as string;
  }

  private async getTransactionToken(html: string): Promise<string> {
    let $ = cheerio.load(html);

    let innerHtml: string | null;

    // Ищем скрипт с нужным id
    const scriptTag = $('script#template-page');

    if (scriptTag.length > 0) {
      // Если нашли скрипт, достаем содержимое
      innerHtml = scriptTag.html();
      if (!innerHtml) {
        this.logger.error('Script tag found but empty');
        throw new BadRequestException('Script tag found but empty');
      }
      // Загружаем заново как HTML
      $ = cheerio.load(innerHtml);
    }

    const token = $('input[name="__RequestVerificationToken"]').val();
    if (!token) {
      this.logger.error('Токен не найден в ответе');
      throw new BadRequestException('Токен не найден в ответе');
    }
    this.logger.verbose(`Parsed RequestVerificationToken ${token}`);
    return token as string;
  }

  async init(): Promise<string> {
    try {
      this.logger.verbose('Request Init page');
      const response = await this.axiosInstance.get(
        this.buildBricsUrl('/Account/Login'),
      );
      this.updateCookies(response.headers['set-cookie']);
      this.logger.verbose('Received Init page');
      return this.getRequestVerificationToken(response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status ?? 'no-status';
        const url = error.config?.url || this.buildBricsUrl('/Account/Login');
        const message = error.message || 'request failed';
        const details = `status=${status}, url=${url}, message=${message}`;
        this.logger.error(`BRICS init failed: ${details}`);
        throw new UnauthorizedException(`BRICS init failed: ${details}`);
      }

      this.logger.error('Error getting token:', error);
      throw error;
    }
  }

  async auth(username: string, password: string): Promise<boolean> {
    try {
      const token = await this.init();
      const loginUrl = new URL(this.buildBricsUrl('/Account/Login'));
      const origin = `${loginUrl.protocol}//${loginUrl.host}`;
      const referer = `${origin}/InternetBanking/Account/Login?ReturnUrl=%2FInternetBanking`;

      const body = new URLSearchParams();
      body.append('__RequestVerificationToken', token);
      body.append('UserName', username);
      body.append('Password', password);
      this.logger.verbose('Send Login request');

      const response = await this.axiosInstance.post(
        loginUrl.toString(),
        body,
        {
          withCredentials: true,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Accept-Language': 'ru-RU,ru;q=0.9',
            Referer: referer,
            Origin: origin,
            Cookie: this.cookies != null ? this.cookies : undefined,
          },
          maxRedirects: 0,
          validateStatus: (status: number) => status >= 200 && status < 400,
        },
      );

      this.updateCookies(response.headers['set-cookie']);
      const locationHeader = response.headers?.location;
      const location = Array.isArray(locationHeader)
        ? locationHeader[0]
        : locationHeader;
      const locationSuffix = location ? `, location=${location}` : '';

      this.logger.verbose(
        `Received Login response ${response.status}${locationSuffix}`,
      );

      if (response.status !== 302) {
        throw new UnauthorizedException(
          `BRICS authentication failed: expected 302, got ${response.status}${locationSuffix}`,
        );
      }

      return true;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status ?? 'no-status';
        const url = error.config?.url || this.buildBricsUrl('/Account/Login');
        const message = error.message || 'request failed';
        const details = `status=${status}, url=${url}, message=${message}`;
        this.logger.error(`BRICS auth request failed: ${details}`);
        throw new UnauthorizedException(`BRICS auth request failed: ${details}`);
      }

      this.logger.error('BRICS auth failed', error as any);
      throw error;
    }
  }
  async getAccount(): Promise<BricsAccountDto> {
    try {
      this.logger.verbose('Send getAccount request');
      const response = await this.axiosInstance.get(
        this.buildBricsUrl('/ru-RU/Reference/CurrentAccounts'),
        {
          withCredentials: true,
          headers: {
            Cookie: this.cookies != null ? this.cookies : undefined,
            Accept: 'application/json',
          },
        },
      );
      this.updateCookies(response.headers['set-cookie']);
      this.logger.verbose(`Received getAccount response ${response.status}`);
      const accounts: BricsAccountDto[] = Object.values(response.data);
      return accounts.find(
        (account: BricsAccountDto) => account.CurrencyID === 417,
      )!!;
    } catch (error) {
      this.logger.error('Error getting accounts:', error);
      throw error;
    }
  }

  async findAccount(accountNoOrPhone: string): Promise<BricsAccountDto> {
    try {
      this.logger.verbose('Send findAccount request');
      const response = await this.axiosInstance.post(
        this.buildBricsUrl('/ru-RU/Reference/GetAccountsByAccountNoOrPhone'),
        {
          account: accountNoOrPhone,
        },
        {
          withCredentials: true,
          headers: {
            Cookie: this.cookies != null ? this.cookies : undefined,
          },
        },
      );
      this.updateCookies(response.headers['set-cookie']);
      this.logger.verbose(`Received findAccount response ${response.status}`);
      const accounts: BricsAccountDto[] = Object.values(response.data);
      return accounts.find(
        (account: BricsAccountDto) => account.CurrencyID === 417,
      )!!;
    } catch (error) {
      this.logger.error('Error getting account information:', error);
      throw error;
    }
  }

  async getCustomerInfo(): Promise<BricsCustomerDto> {
    const account = await this.getAccount();
    const foundAccount = await this.findAccount(account.AccountNo);

    try {
      this.logger.verbose('Send getCustomerInfo request');
      const response = await this.axiosInstance.get(
        `${this.INTEGRATION_API_ROOT}/OnlineBank.IntegrationService/api/customer/GetCustomerFullInfo?customerID=${foundAccount.CustomerID}`,
      );
      this.logger.verbose(
        `Received getCustomerInfo response ${response.status}`,
      );
      return response.data;
    } catch (error) {
      this.logger.error('Error getting customer information:', error);
      throw error;
    }
  }

  async getCustomerAccount(customerId: string): Promise<BricsAccountDto> {
    try {
      this.logger.verbose('Send getCustomerAccounts request');
      const response = await this.axiosInstance.get(
        `${this.INTEGRATION_API_ROOT}/OnlineBank.IntegrationService/api/Deposits/GetCurrentAccounts?customerID=${customerId}`,
      );
      this.logger.verbose(
        `Received getCustomerAccounts response ${response.status}`,
      );
      const rawResult = response.data?.Result;
      const accounts: any[] = Array.isArray(rawResult)
        ? rawResult
        : Array.isArray(response.data)
          ? response.data
          : Object.values(rawResult ?? {});
      const normalizedAccounts: BricsAccountDto[] = accounts.map((item: any) => ({
        ...item,
        AccountNo:
          item?.AccountNo ??
          item?.accountNo ??
          item?.AccountNumber ??
          item?.account_number ??
          item?.Iban ??
          item?.IBAN,
        CurrencyID: Number(item?.CurrencyID ?? item?.currencyId ?? item?.currency_id),
        CustomerID: Number(item?.CustomerID ?? item?.customerId ?? item?.customer_id),
        Balance: Number(item?.Balance ?? item?.balance ?? 0),
      }));

      const account = normalizedAccounts.find(
        (item: BricsAccountDto) => Number(item?.CurrencyID) === 417,
      );

      if (!account) {
        const currencyIds = normalizedAccounts
          .map((item: any) => item?.CurrencyID)
          .filter((v: any) => v != null)
          .join(',');
        throw new BadRequestException(
          `ABS SOM account not found for customer ${customerId}. CurrencyID=417 is required. AvailableCurrencyIDs=[${currencyIds}]`,
        );
      }
      if (!account.AccountNo) {
        const matchedRawAccount = accounts.find((item: any) => Number(item?.CurrencyID ?? item?.currencyId ?? item?.currency_id) === 417);
        const rawKeys = matchedRawAccount ? Object.keys(matchedRawAccount).join(',') : 'unknown';
        throw new BadRequestException(
          `ABS account is missing account number for customer ${customerId} (CurrencyID=${account.CurrencyID}). Expected one of [AccountNo,accountNo,AccountNumber,account_number,Iban,IBAN]. RawKeys=[${rawKeys}]`,
        );
      }
      return account;
    } catch (error) {
      this.logger.error('Error getting customer information:', error);
      throw error;
    }
  }

  private buildPhoneLookupCandidates(phone?: string): string[] {
    const raw = (phone || '').trim();
    if (!raw) return [];

    const digits = raw.replace(/\D/g, '');
    const candidates = new Set<string>();
    candidates.add(raw);
    candidates.add(raw.replace(/\s+/g, ''));
    if (digits) {
      candidates.add(digits);
      candidates.add(`+${digits}`);
      if (digits.startsWith('996') && digits.length > 3) {
        candidates.add(`0${digits.slice(3)}`);
      }
    }
    return [...candidates].filter(Boolean);
  }

  async resolveCustomerSomAccount(
    customerId: string,
    fallbackPhone?: string,
  ): Promise<BricsAccountDto> {
    let integrationError: unknown;
    try {
      const account = await this.getCustomerAccount(customerId);
      if (account?.AccountNo) return account;
    } catch (error) {
      integrationError = error;
      const details = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(
        `getCustomerAccount failed for customer=${customerId}: ${details}`,
      );
    }

    const phoneCandidates = this.buildPhoneLookupCandidates(fallbackPhone);
    for (const candidate of phoneCandidates) {
      try {
        const found = await this.findAccount(candidate);
        if (found?.CurrencyID === 417 && found?.AccountNo) {
          this.logger.warn(
            `resolveCustomerSomAccount fallback by phone succeeded for customer=${customerId} using candidate=${candidate}`,
          );
          return found;
        }
      } catch (error) {
        const details = error instanceof Error ? error.message : 'unknown';
        this.logger.warn(
          `findAccount fallback failed for customer=${customerId} candidate=${candidate}: ${details}`,
        );
      }
    }

    if (integrationError) throw integrationError;
    throw new BadRequestException(
      `ABS SOM account not found for customer ${customerId}. Fallback by phone did not return CurrencyID=417 account.`,
    );
  }

  async getSomBalance(): Promise<number> {
    try {
      this.logger.verbose('Send getSomBalance request');
      const response = await this.axiosInstance.get(
        this.buildBricsUrl('/ru-RU/Reference/CurrentAccounts'),
        {
          withCredentials: true,
          headers: {
            Cookie: this.cookies != null ? this.cookies : undefined,
          },
        },
      );
      this.updateCookies(response.headers['set-cookie']);
      this.logger.verbose(`Received getSomBalance response ${response.status}`);
      const accounts: BricsAccountDto[] = Object.values(response.data);
      const account = accounts.find(
        (account: BricsAccountDto) => account.CurrencyID === 417,
      );
      return account?.Balance || 0;
    } catch (error) {
      this.logger.error('Error getting SOM balance:', error);
      throw error;
    }
  }

  async initTransactionScreen(accountNo: string): Promise<string> {
    try {
      this.logger.verbose(`Send initTransactionScreen request ${accountNo}`);
      const response = await this.axiosInstance.get(
        this.buildBricsUrl(`/ru-RU/Accounts/InternalTransaction?Mode=Create&OperationType=InternalOperation&AccountNo=${accountNo}&CurrencyID=417`),
        {
          withCredentials: true,
          headers: {
            Cookie: this.cookies != null ? this.cookies : undefined,
          },
        },
      );
      this.updateCookies(response.headers['set-cookie']);
      this.logger.verbose(
        `Received initTransactionScreen response ${response.status}`,
      );

      const pageAlert = this.extractBricsPageAlert(response.data);
      if (pageAlert) {
        throw new BadRequestException(
          `ABS prepare transfer failed: ${pageAlert}`,
        );
      }

      return this.getTransactionToken(response.data);
    } catch (error) {
      this.throwBricsRequestError('prepare transfer', error);
      throw error;
    }
  }

  async ensureTransferSourceAccountAccessible(accountNo: string): Promise<void> {
    await this.initTransactionScreen(accountNo);
  }

  async createTransactionCryptoToFiat(
    amount: number,
    customerId: string,
    paymentPurpose?: string,
    resolvedCustomerAccountNo?: string,
    fallbackPhone?: string,
    sourceAccountNo?: string,
  ): Promise<number> {
    let customerAccountNo = resolvedCustomerAccountNo;
    if (!customerAccountNo) {
      const customerAccount = await this.resolveCustomerSomAccount(
        customerId,
        fallbackPhone,
      );
      customerAccountNo = customerAccount.AccountNo;
    }

    if (!customerAccountNo) {
      throw new BadRequestException(
        `Unable to resolve destination SOM account for customer ${customerId}`,
      );
    }
    const fromAccountNo = (sourceAccountNo || this.CT_ACCOUNT_NO || '').trim();
    if (!fromAccountNo) {
      throw new BadRequestException('ABS source account is not configured');
    }

    return this.createTransfer(
      fromAccountNo,
      customerAccountNo,
      amount,
      paymentPurpose ?? customerId,
    );
  }

  async createTransactionFiatToCrypto(
    amount: number,
    customerId: string,
    paymentPurpose?: string,
  ): Promise<number> {
    let account: BricsAccountDto | null = null;
    try {
      account = await this.getCustomerAccount(customerId);
    } catch (error) {
      const details = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(
        `getCustomerAccount failed for customer=${customerId}, fallback to authenticated BRICS session account: ${details}`,
      );
    }

    if (!account?.AccountNo) {
      account = await this.getAccount();
    }
    if (!account?.AccountNo) {
      throw new BadRequestException(
        `Unable to resolve source SOM account for customer ${customerId}`,
      );
    }

    return this.createTransfer(
      account.AccountNo,
      this.CT_ACCOUNT_NO,
      amount,
      paymentPurpose ?? customerId,
    );
  }

  async createTransferFiatToFiat(
    amount: number,
    customerId: string,
    receiverId: string,
    paymentPurpose?: string,
  ): Promise<number> {
    const account = await this.getCustomerAccount(customerId);
    const receiverAccount = await this.getCustomerAccount(receiverId);
    return this.createTransfer(
      account.AccountNo,
      receiverAccount.AccountNo,
      amount,
      paymentPurpose ?? customerId,
    );
  }

  async createTransfer(
    fromAccount: string,
    toAccount: string,
    amount: number,
    comment: string,
  ): Promise<number> {
    try {
      const token = await this.initTransactionScreen(fromAccount);

      const transactionBody = {
        InternalOperationType: 1,
        OperationID: 0,
        DtAccountNo: fromAccount,
        CtAccountNo: toAccount,
        CurrencyID: 417,
        Sum: amount,
        Comment: comment,
        IsTemplate: false,
        Schedule: null,
      };

      let response;
      try {
        response = await this.sendCreateTransferRequest(token, transactionBody);
      } catch (error) {
        const extractedMessage = axios.isAxiosError(error)
          ? this.extractBricsErrorMessage(error.response?.data)
          : null;
        const shouldRetryWithSafeComment =
          axios.isAxiosError(error)
          && error.response?.status === 500
          && this.isInvalidUri1023Error(extractedMessage);

        if (!shouldRetryWithSafeComment) {
          throw error;
        }

        const fallbackComment = this.buildSafeAsciiComment(comment);
        this.logger.warn(
          `ABS create transfer failed with 1023 Invalid URI, retrying with safe comment. originalComment="${comment}" fallbackComment="${fallbackComment}"`,
        );

        response = await this.sendCreateTransferRequest(
          token,
          { ...transactionBody, Comment: fallbackComment },
        );
      }

      const operationId = response.data.operationID;
      this.logger.log('Operation ID:', operationId);

      await this.confirmLoad(operationId);
      await this.confirmFinal(operationId);

      return operationId;
    } catch (error) {
      this.throwBricsRequestError('create transfer', error);
      throw error;
    }
  }

  async confirmLoad(operationId: number): Promise<boolean> {
    this.logger.verbose('Send confirmLoad request');
    const response = await this.axiosInstance.post(
      this.buildBricsUrl('/ru-RU/Operation/Operation/ConfirmLoad'),
      {
        operationID: operationId,
      },
      {
        withCredentials: true,
        headers: {
          Cookie: this.cookies != null ? this.cookies : undefined,
        },
      },
    );
    this.updateCookies(response.headers['set-cookie']);
    this.logger.verbose(
      `Received confirmLoad response ${response.status} ${JSON.stringify(response.data)}`,
    );
    return response.status === 200;
  }

  async confirmFinal(operationId: number): Promise<boolean> {
    this.logger.verbose('Send confirmFinal request');
    const response = await this.axiosInstance.post(
      this.buildBricsUrl('/ru-RU/Operation/Operation/Confirm'),
      {
        OperationID: operationId,
        OperationTypeID: 1,
      },
      {
        withCredentials: true,
        headers: {
          Cookie: this.cookies != null ? this.cookies : undefined,
        },
      },
    );
    this.updateCookies(response.headers['set-cookie']);
    this.logger.verbose(
      `Received confirmFinal response ${response.status} ${JSON.stringify(response.data)}`,
    );
    return response.status === 200;
  }
}

