import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { BricsAccountDto, BricsCustomerDto } from './dto/brics.dto';
import {
  mockLoginResponse,
  mockCustomerInfo,
  mockAccountsResponse,
} from './mocks/brics.mocks';

@Injectable()
export class BricsService {
  private readonly BRICS_API_ROOT: string;
  private readonly CT_ACCOUNT_NO: string;
  private readonly axiosInstance: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    this.BRICS_API_ROOT = this.configService.get<string>('BRICS_API_ROOT')!;
    this.CT_ACCOUNT_NO = this.configService.get<string>('CT_ACCOUNT_NO')!;
    this.axiosInstance = axios.create({
      withCredentials: true,
    });
  }

  private async getRequestVerificationToken(html: string): Promise<string> {
    const $ = cheerio.load(html);
    const token = $('input[name="__RequestVerificationToken"]').val();
    if (!token) {
      throw new Error('Токен не найден в ответе');
    }
    return token as string;
  }

  private async getRequestIdentificationToken(html: string): Promise<string> {
    const $ = cheerio.load(html);
    const token = $('input[name="__RequestIdentificationToken"]').val();
    if (!token) {
      throw new Error('Токен не найден в ответе');
    }
    return token as string;
  }

  async init(): Promise<string> {
    try {
      const response = await this.axiosInstance.get(
        `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Account/Login`,
      );

      const cookies = response.headers['set-cookie'];
      if (cookies) {
        this.axiosInstance.defaults.headers.common['Cookie'] =
          cookies.join('; ');
      }

      //   return this.getRequestVerificationToken(response.data);
      return 'mock_token';
    } catch (error) {
      console.error('Error getting token:', error);
      throw error;
    }
  }

  async auth(username: string, password: string): Promise<boolean> {
    console.log(`Попытка авторизации пользователя: ${username}`);
    try {
      // Мок авторизации
      return true;
    } catch (error) {
      console.error('Ошибка при авторизации:', error);
      throw error;
    }
  }

  async getAccount(): Promise<BricsAccountDto> {
    try {
      const response = await this.axiosInstance.get(
        `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Reference/CurrentAccounts`,
      );
      return response.data.find(
        (account: BricsAccountDto) => account.CurrencyID === 417,
      );
    } catch (error) {
      console.error('Error getting accounts:', error);
      throw error;
    }
  }

  async findAccount(accountNoOrPhone: string): Promise<BricsAccountDto> {
    try {
      const response: BricsAccountDto[] = await this.axiosInstance.post(
        `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Reference/GetAccountsByAccountNoOrPhone`,
        {
          account: accountNoOrPhone,
        },
      );
      return response.find(
        (account: BricsAccountDto) => account.CurrencyID === 417,
      )!;
    } catch (error) {
      console.error('Error getting account information:', error);
      throw error;
    }
  }

  async getCustomerInfo(): Promise<BricsCustomerDto> {
    try {
      //   const response = await this.axiosInstance.get(
      //     `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Reference/CustomerInfo`,
      //   );
      //   return response.data;
      return mockCustomerInfo;
    } catch (error) {
      console.error('Error getting customer information:', error);
      throw error;
    }
  }

  async getSomBalance(): Promise<number> {
    try {
      // Мок баланса в сомах
      const somAccount = mockAccountsResponse.data.find(
        (account: BricsAccountDto) => account.CurrencyID === 417,
      );
      return somAccount?.Balance || 0;
    } catch (error) {
      console.error('Error getting SOM balance:', error);
      throw error;
    }
  }

  async initTransactionScreen(): Promise<string> {
    try {
      //   const response = await this.axiosInstance.get(
      //     `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Accounts/InternalTransaction?Mode=Create&OperationType=InternalOperation&AccountNo=1340000087861476&CurrencyID=417`,
      //   );

      //   return this.getRequestIdentificationToken(response.data);
      return 'mock_token';
    } catch (error) {
      console.error('Ошибка при получении токена:', error);
      throw error;
    }
  }

  async createTransactionCryptoToFiat(
    amount: number,
    customerId: number,
  ): Promise<number> {
    // const token = await this.initTransactionScreen();
    // const ctAccountNo = await this.findAccount();
    // const accountNo = this.CT_ACCOUNT_NO;

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
    // return response.data.operationID;
    const operationId = 1239391;
    await this.confirmLoad(operationId);
    return operationId;
  }

  async createTransactionFiatToCrypto(
    amount: number,
    customerId: number,
  ): Promise<number> {
    // const token = await this.initTransactionScreen();
    // const accountNo = await this.findAccount();
    // const ctAccountNo = this.CT_ACCOUNT_NO;

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
    // return response.data.operationID;
    const operationId = 1239391;
    await this.confirmLoad(operationId);
    return operationId;
  }

  async confirmLoad(operationId: number): Promise<boolean> {
    const response = await this.axiosInstance.post(
      `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Operation/Operation/ConfirmLoad`,
      {
        operationID: operationId,
      },
    );

    await this.confirmFinal(operationId);
    return response.status === 200;
  }
  async confirmFinal(operationId: number): Promise<boolean> {
    const response = await this.axiosInstance.post(
      `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Operation/Operation/Confirm`,
      {
        OperationID: operationId,
        OperationTypeID: 1,
      },
    );
    return response.status === 200;
  }
}
