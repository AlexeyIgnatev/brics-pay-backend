import { Injectable, Logger, Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { BricsAccountDto, BricsCustomerDto } from './dto/brics.dto';
import * as https from 'node:https';

@Injectable({ scope: Scope.REQUEST })
export class BricsService {
  private readonly BRICS_API_ROOT: string;
  private readonly CT_ACCOUNT_NO: string;
  private readonly axiosInstance: AxiosInstance;
  private readonly logger = new Logger(BricsService.name);
  private cookies: string = '';

  constructor(private readonly configService: ConfigService) {
    this.BRICS_API_ROOT = this.configService.get<string>('BRICS_API_ROOT')!;
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
    const newCookies = setCookieHeaders.map(cookieString => cookieString.split(';')[0]); // Берём только "ключ=значение"

    // Если уже были куки, добавляем новые
    const existingCookies = this.cookies
      ? this.cookies.split('; ').reduce((acc, cookie) => {
        const [key, value] = cookie.split('=');
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>)
      : {};

    // Обновляем существующие куки новыми
    newCookies.forEach(cookie => {
      const [key, value] = cookie.split('=');
      existingCookies[key] = value;
    });

    // Сохраняем обновлённую строку кук
    this.cookies = Object.entries(existingCookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');

    this.logger.debug(`Updated cookie: ${this.cookies}`);
  }

  private async getRequestVerificationToken(html: string): Promise<string> {
    const $ = cheerio.load(html);
    const token = $('input[name="__RequestVerificationToken"]').val();
    if (!token) {
      this.logger.error('Токен не найден в ответе');
      throw new Error('Токен не найден в ответе');
    }
    this.logger.debug(`Parsed RequestVerificationToken ${token}`);
    return token as string;
  }

  private async getRequestIdentificationToken(html: string): Promise<string> {
    const $ = cheerio.load(html);
    const token = $('input[name="__RequestIdentificationToken"]').val();
    if (!token) {
      this.logger.error('Токен не найден в ответе');
      throw new Error('Токен не найден в ответе');
    }
    this.logger.debug(`Parsed RequestIdentificationToken ${token}`);
    return token as string;
  }

  async init(): Promise<string> {
    try {
      this.logger.debug('Request Init page');
      const response = await this.axiosInstance.get(
        `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Account/Login`,
      );
      this.updateCookies(response.headers['set-cookie']);
      this.logger.debug('Received Init page');
      return this.getRequestVerificationToken(response.data);
    } catch (error) {
      this.logger.error('Error getting token:', error);
      throw error;
    }
  }

  async auth(username: string, password: string): Promise<boolean> {
    const token = await this.init();
    try {
      const body = {
        __RequestVerificationToken: token,
        UserName: username,
        Password: password,
      };
      this.logger.debug('Send Login request', JSON.stringify(body));
      const response = await this.axiosInstance.post(
        `${this.BRICS_API_ROOT}/InternetBanking/Account/Login?ReturnUrl=%2FInternetBanking%2Fru-RU`,
        body,
        {
          withCredentials: true,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Accept-Language': 'ru-RU,ru;q=0.9',
            'Referer': 'https://192.168.255.109/InternetBanking/Account/Login?ReturnUrl=%2FInternetBanking%2Fru-RU',
            'Origin': 'https://192.168.255.109',
            'Cookie': this.cookies != null ? this.cookies : undefined,
          },
          maxRedirects: 0,
          validateStatus: (status: number) =>
            status >= 200 && status < 400,
        },
      );
      this.updateCookies(response.headers['set-cookie']);
      this.logger.debug(`Received Login response ${response.status}`);
      return response.status === 302;
    } catch (error) {
      this.logger.error('Ошибка при авторизации:', error);
      throw error;
    }
  }

  async getAccount(): Promise<BricsAccountDto> {
    try {
      this.logger.debug('Send getAccount request');
      const response = await this.axiosInstance.get(
        `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Reference/CurrentAccounts`,
        {
          withCredentials: true,
          headers: {
            'Cookie': this.cookies != null ? this.cookies : undefined,
          },
        },
      );
      this.logger.debug(`Received getAccount response ${response.status}`);
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
      this.logger.debug('Send findAccount request');
      const response = await this.axiosInstance.post(
        `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Reference/GetAccountsByAccountNoOrPhone`,
        {
          account: accountNoOrPhone,
        },
      );
      this.logger.debug(`Received findAccount response ${response.status}`);
      return response.data.find(
        (account: BricsAccountDto) => account.CurrencyID === 417,
      )!;
    } catch (error) {
      this.logger.error('Error getting account information:', error);
      throw error;
    }
  }

  async getCustomerInfo(): Promise<BricsCustomerDto> {
    const account = await this.getAccount();
    const findedAccount = await this.findAccount(account.AccountNo);

    try {
      this.logger.debug('Send getCustomerInfo request');
      const response = await this.axiosInstance.get(
        `${this.BRICS_API_ROOT}/OnlineBank.IntegrationService/api/customer/GetCustomerFullInfo?customerID=${findedAccount.CustomerID}`,
      );
      this.logger.debug(`Received getCustomerInfo response ${response.status}`);
      return response.data;
    } catch (error) {
      this.logger.error('Error getting customer information:', error);
      throw error;
    }
  }

  async getSomBalance(): Promise<number> {
    try {
      this.logger.debug('Send getSomBalance request');
      const response = await this.axiosInstance.get(
        `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Reference/CurrentAccounts`,
      );
      this.logger.debug(`Received getSomBalance response ${response.status}`);
      return (
        response.data.find(
          (account: BricsAccountDto) => account.CurrencyID === 417,
        )?.Balance || 0
      );
    } catch (error) {
      this.logger.error('Error getting SOM balance:', error);
      throw error;
    }
  }

  async initTransactionScreen(): Promise<string> {
    try {
      this.logger.debug('Send initTransactionScreen request');
      const response = await this.axiosInstance.get(
        `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Accounts/InternalTransaction?Mode=Create&OperationType=InternalOperation&AccountNo=1340000087861476&CurrencyID=417`,
      );
      this.logger.debug(`Received initTransactionScreen response ${response.status}`);
      return this.getRequestIdentificationToken(response.data);
    } catch (error) {
      this.logger.error('Ошибка при получении токена:', error);
      throw error;
    }
  }

  async createTransactionCryptoToFiat(
    amount: number,
    customerId: string,
  ): Promise<number> {
    const token = await this.initTransactionScreen();
    const ctAccountNo = await this.findAccount(customerId);
    const accountNo = this.CT_ACCOUNT_NO;

    this.logger.debug('Send createTransactionCryptoToFiat request');
    const response = await this.axiosInstance.post(
      `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Accounts/InternalTransaction`,
      {
        DtAccountNo: accountNo,
        CtAccountNo: ctAccountNo,
        Sum: amount,
        Comment: customerId,
      },
      {
        headers: {
          __requestverificationtoken: token,
        },
      },
    );
    this.logger.debug(`Received createTransactionCryptoToFiat response ${response.status}`);
    this.logger.log('Operation ID:', response.data.operationID);
    return response.data.operationID;
  }

  async createTransactionFiatToCrypto(
    amount: number,
    customerId: string,
  ): Promise<number> {
    const token = await this.initTransactionScreen();
    const accountNo = await this.findAccount(customerId.toString());
    const ctAccountNo = this.CT_ACCOUNT_NO;

    this.logger.debug('Send createTransactionFiatToCrypto request');
    const response = await this.axiosInstance.post(
      `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Accounts/InternalTransaction`,
      {
        DtAccountNo: accountNo,
        CtAccountNo: ctAccountNo,
        Sum: amount,
        Comment: customerId,
      },
      {
        headers: {
          __requestverificationtoken: token,
        },
      },
    );
    this.logger.debug(`Received createTransactionFiatToCrypto response ${response.status}`);
    this.logger.log('Operation ID:', response.data.operationID);
    return response.data.operationID;
  }

  async confirmLoad(operationId: number): Promise<boolean> {
    this.logger.debug('Send confirmLoad request');
    const response = await this.axiosInstance.post(
      `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Operation/Operation/ConfirmLoad`,
      {
        operationID: operationId,
      },
    );
    this.logger.debug(`Received confirmLoad response ${response.status}`);
    await this.confirmFinal(operationId);
    return response.status === 200;
  }

  async confirmFinal(operationId: number): Promise<boolean> {
    this.logger.debug('Send confirmFinal request');
    const response = await this.axiosInstance.post(
      `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Operation/Operation/Confirm`,
      {
        OperationID: operationId,
        OperationTypeID: 1,
      },
    );
    this.logger.debug(`Received confirmFinal response ${response.status}`);
    return response.status === 200;
  }
}
