import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Web3 from 'web3';
import { mockContractResponse } from './mocks/ethereum.mocks';

@Injectable()
export class EthereumService {
  private readonly web3: Web3;
  private readonly TOKEN_ADDRESS: string;
  private readonly RPC_URL: string;

  constructor(private readonly configService: ConfigService) {
    this.RPC_URL = this.configService.get<string>('RPC_URL')!;
    this.TOKEN_ADDRESS = this.configService.get<string>('TOKEN_ADDRESS')!;
    this.web3 = new Web3(this.RPC_URL);
  }

  generateAddress(): { address: string; privateKey: string } {
    const account = this.web3.eth.accounts.create();
    return {
      address: account.address,
      privateKey: account.privateKey,
    };
  }

  validateAddress(address: string): boolean {
    try {
      this.web3.utils.toChecksumAddress(address);
      return true;
    } catch {
      return false;
    }
  }

  async getTokenBalance(address: string): Promise<number> {
    try {
      // Мок контракта
      const contract = mockContractResponse;
      const balance = await contract.methods.balanceOf(address).call();
      return Number(balance) / 10 ** 18;
    } catch (error) {
      console.error('Error getting token balance:', error);
      throw error;
    }
  }
}
