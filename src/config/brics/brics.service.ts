import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { BricsAccountDto, BricsCustomerDto } from './dto/brics.dto';
import {
  mockLoginResponse,
  mockCustomerInfo,
  mockAccountsResponse,
} from './mocks/brics.mocks';

@Injectable()
export class BricsService {
  private readonly BRICS_API_ROOT: string;
  private readonly axiosInstance: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    this.BRICS_API_ROOT = this.configService.get<string>('BRICS_API_ROOT')!;
    this.axiosInstance = axios.create({
      withCredentials: true,
    });
  }

  async init(): Promise<string> {
    try {
      // Мок ответа с токеном
      const response = mockLoginResponse;
      const cookies = response.headers['set-cookie'];
      if (cookies) {
        this.axiosInstance.defaults.headers.common['Cookie'] =
          cookies.join('; ');
      }
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

  async findAccount(): Promise<number> {
    const account = await this.getAccount();
    try {
      const response: BricsAccountDto[] = await this.axiosInstance.post(
        `${this.BRICS_API_ROOT}/InternetBanking/ru-RU/Reference/GetAccountsByAccountNoOrPhone`,
        {
          account: account.AccountNo,
        },
      );
      return response.find(
        (account: BricsAccountDto) => account.CurrencyID === 417,
      )!.CustomerID;
    } catch (error) {
      console.error('Error getting account information:', error);
      throw error;
    }
  }

  async getCustomerInfo(): Promise<BricsCustomerDto> {
    try {
      // Мок информации о клиенте
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
}
