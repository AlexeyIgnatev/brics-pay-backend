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
  }

  private async getRequestVerificationToken(html: string): Promise<string> {
    const $ = cheerio.load(html);
    const token = $('input[name="__RequestVerificationToken"]').val();
    if (!token) {
      this.logger.error('Токен не найден в ответе');
      throw new Error('Токен не найден в ответе');
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
        throw new Error('Script tag found but empty');
      }
      // Загружаем заново как HTML
      $ = cheerio.load(innerHtml);
    }

    const token = $('input[name="__RequestVerificationToken"]').val();
    if (!token) {
      this.logger.error('Токен не найден в ответе');
      throw new Error('Токен не найден в ответе');
    }
    this.logger.verbose(`Parsed RequestVerificationToken ${token}`);
    return token as string;
  }

  async init(): Promise<string> {
    try {
      this.logger.verbose('Request Init page');
      const response = await this.axiosInstance.get(
        `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Account/Login`,
      );
      this.updateCookies(response.headers['set-cookie']);
      this.logger.verbose('Received Init page');
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
      this.logger.verbose('Send Login request', JSON.stringify(body));
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
      this.logger.verbose(`Received Login response ${response.status}`);
      return response.status === 302;
    } catch (error) {
      this.logger.error('Ошибка при авторизации:', error);
      throw error;
    }
  }

  async getAccount(): Promise<BricsAccountDto> {
    try {
      this.logger.verbose('Send getAccount request');
      const response = await this.axiosInstance.get(
        `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Reference/CurrentAccounts`,
        {
          withCredentials: true,
          headers: {
            'Cookie': this.cookies != null ? this.cookies : undefined,
            'Accept': 'application/json',
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
        `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Reference/GetAccountsByAccountNoOrPhone`,
        {
          account: accountNoOrPhone,
        },
        {
          withCredentials: true,
          headers: {
            'Cookie': this.cookies != null ? this.cookies : undefined,
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
    const findedAccount = await this.findAccount(account.AccountNo);

    try {
      this.logger.verbose('Send getCustomerInfo request');
      const response = await this.axiosInstance.get(
        `${this.BRICS_API_ROOT}/OnlineBank.IntegrationService/api/customer/GetCustomerFullInfo?customerID=${findedAccount.CustomerID}`,
      );
      this.logger.verbose(`Received getCustomerInfo response ${response.status}`);
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
        `${this.BRICS_API_ROOT}/OnlineBank.IntegrationService/api/Deposits/GetCurrentAccounts?customerID=${customerId}`,
      );
      this.logger.verbose(`Received getCustomerAccounts response ${response.status}`);
      return response.data['Result'].find(
        (account: BricsAccountDto) => account.CurrencyID === 417,
      )!!;
    } catch (error) {
      this.logger.error('Error getting customer information:', error);
      throw error;
    }
  }

  async getSomBalance(): Promise<number> {
    try {
      this.logger.verbose('Send getSomBalance request');
      const response = await this.axiosInstance.get(
        `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Reference/CurrentAccounts`,
        {
          withCredentials: true,
          headers: {
            'Cookie': this.cookies != null ? this.cookies : undefined,
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
        `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Accounts/InternalTransaction?Mode=Create&OperationType=InternalOperation&AccountNo=${accountNo}&CurrencyID=417`,
        {
          withCredentials: true,
          headers: {
            'Cookie': this.cookies != null ? this.cookies : undefined,
          },
        },
      );
      this.updateCookies(response.headers['set-cookie']);
      this.logger.verbose(`Received initTransactionScreen response ${response.status}`);
      return this.getTransactionToken(response.data);
    } catch (error) {
      this.logger.error('Ошибка при получении токена:', error);
      throw error;
    }
  }

  async createTransactionCryptoToFiat(
    amount: number,
    customerId: string,
  ): Promise<number> {
    // const token = await this.initTransactionScreen();
    // const ctAccountNo = await this.findAccount(customerId);
    // const accountNo = this.CT_ACCOUNT_NO;
    //
    // this.logger.verbose('Send createTransactionCryptoToFiat request');
    // const response = await this.axiosInstance.post(
    //   `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Accounts/InternalTransaction`,
    //   {
    //     DtAccountNo: accountNo,
    //     CtAccountNo: ctAccountNo,
    //     Sum: amount,
    //     Comment: customerId,
    //   },
    //   {
    //     headers: {
    //       __requestverificationtoken: token,
    //     },
    //   },
    // );
    // this.logger.verbose(`Received createTransactionCryptoToFiat response ${response.status}`);
    // this.logger.log('Operation ID:', response.data.operationID);
    // return response.data.operationID;
    return 0;
  }

  async createTransactionFiatToCrypto(
    amount: number,
    customerId: string,
  ): Promise<number> {
    const account = await this.getCustomerAccount(customerId);
    const token = await this.initTransactionScreen(account.AccountNo);
    const ctAccountNo = this.CT_ACCOUNT_NO;

    this.logger.verbose('Send createTransactionFiatToCrypto request');
    const response = await this.axiosInstance.post(
      `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Accounts/InternalTransaction`,
      {
        InternalOperationType: 1,
        OperationID: 0,
        DtAccountNo: account.AccountNo,
        CtAccountNo: ctAccountNo,
        CurrencyID: 417,
        Sum: amount,
        Comment: customerId,
        IsTemplate: false,
        Schedule: null
      },
      {
        withCredentials: true,
        headers: {
          __requestverificationtoken: token,
          'Cookie': this.cookies != null ? this.cookies : undefined,
        },
      },
    );
    this.updateCookies(response.headers['set-cookie']);
    this.logger.verbose(`Received createTransactionFiatToCrypto response ${response.status}`);
    this.logger.log('Operation ID:', response.data.operationID);
    const operationId = response.data.operationID;
    await this.confirmLoad(operationId);
    await this.confirmFinal(operationId);
    return response.data.operationID;
  }

  async confirmLoad(operationId: number): Promise<boolean> {
    this.logger.verbose('Send confirmLoad request');
    const response = await this.axiosInstance.post(
      `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Operation/Operation/ConfirmLoad`,
      {
        operationID: operationId,
      },
      {
        withCredentials: true,
        headers: {
          'Cookie': this.cookies != null ? this.cookies : undefined,
        },
      },
    );
    this.updateCookies(response.headers['set-cookie']);
    this.logger.verbose(`Received confirmLoad response ${response.status}`);
    return response.status === 200;
  }

  async confirmFinal(operationId: number): Promise<boolean> {
    this.logger.verbose('Send confirmFinal request');
    const response = await this.axiosInstance.post(
      `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Operation/Operation/Confirm`,
      {
        OperationID: operationId,
        OperationTypeID: 1,
      },
      {
        withCredentials: true,
        headers: {
          'Cookie': this.cookies != null ? this.cookies : undefined,
        },
      },
    );
    this.updateCookies(response.headers['set-cookie']);
    this.logger.verbose(`Received confirmFinal response ${response.status}`);
    return response.status === 200;
  }
}
