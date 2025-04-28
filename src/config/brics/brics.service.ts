import { Injectable, Logger, Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import { BricsAccountDto, BricsCustomerDto } from './dto/brics.dto';
import * as https from 'node:https';

@Injectable({ scope: Scope.REQUEST })
export class BricsService {
  private readonly BRICS_API_ROOT: string;
  private readonly CT_ACCOUNT_NO: string;
  private readonly axiosInstance: AxiosInstance;
  private readonly logger = new Logger(BricsService.name);

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
      this.logger.debug('Send Login request');
      const response = await this.axiosInstance.post(
        `${this.BRICS_API_ROOT}/InternetBanking/Account/Login?ReturnUrl=/InternetBanking/ru-RU`,
        {
          __RequestVerificationToken: token,
          UserName: username,
          Password: password,
        },
        { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
      );
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
      );
      this.logger.debug(`Received getAccount response ${response.status}`);
      return response.data.find(
        (account: BricsAccountDto) => account.CurrencyID === 417,
      );
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
