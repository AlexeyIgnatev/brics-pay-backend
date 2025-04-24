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

      return this.getRequestVerificationToken(response.data);
    } catch (error) {
      console.error('Error getting token:', error);
      throw error;
    }
  }

  async auth(username: string, password: string): Promise<boolean> {
    const token = await this.init();
    try {
      const response = await this.axiosInstance.post(
        `${this.BRICS_API_ROOT}/InternetBanking/Account/Login?ReturnUrl=/InternetBanking/ru-RU`,
        {
          __RequestVerificationToken: token,
          UserName: username,
          Password: password,
        },
      );
      return response.status === 302;
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
    const account = await this.getAccount();
    const findedAccount = await this.findAccount(account.AccountNo);

    try {
      const response = await this.axiosInstance.get(
        `${this.BRICS_API_ROOT}/OnlineBank.IntegrationService/api/customer/GetCustomerFullInfo?customerID=${findedAccount.CustomerID}`,
      );
      return response.data;
    } catch (error) {
      console.error('Error getting customer information:', error);
      throw error;
    }
  }

  async getSomBalance(): Promise<number> {
    try {
      const response = await this.axiosInstance.get(
        `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Reference/CurrentAccounts`,
      );
      return (
        response.data.find(
          (account: BricsAccountDto) => account.CurrencyID === 417,
        )?.Balance || 0
      );
    } catch (error) {
      console.error('Error getting SOM balance:', error);
      throw error;
    }
  }

  async initTransactionScreen(): Promise<string> {
    try {
      const response = await this.axiosInstance.get(
        `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Accounts/InternalTransaction?Mode=Create&OperationType=InternalOperation&AccountNo=1340000087861476&CurrencyID=417`,
      );

      return this.getRequestIdentificationToken(response.data);
    } catch (error) {
      console.error('Ошибка при получении токена:', error);
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
    return response.data.operationID;
  }

  async createTransactionFiatToCrypto(
    amount: number,
    customerId: string,
  ): Promise<number> {
    const token = await this.initTransactionScreen();
    const accountNo = await this.findAccount(customerId.toString());
    const ctAccountNo = this.CT_ACCOUNT_NO;

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
    return response.data.operationID;
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
