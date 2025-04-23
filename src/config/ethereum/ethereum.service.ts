import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Web3 from 'web3';
import {
  mockContractResponse,
  mockTransactionReceipt,
} from './mocks/ethereum.mocks';

@Injectable()
export class EthereumService {
  private readonly web3: Web3;
  private readonly TOKEN_ADDRESS: string;
  private readonly RPC_URL: string;
  private readonly PLATFORM_FEE: number;
  private readonly ADMIN_ADDRESS: string;
  private readonly ADMIN_PRIVATE_KEY: string;

  constructor(private readonly configService: ConfigService) {
    this.RPC_URL = this.configService.get<string>('RPC_URL')!;
    this.TOKEN_ADDRESS = this.configService.get<string>('TOKEN_ADDRESS')!;
    this.PLATFORM_FEE = this.configService.get<number>('PLATFORM_FEE')!;
    this.ADMIN_ADDRESS = this.configService.get<string>('ADMIN_ADDRESS')!;
    this.ADMIN_PRIVATE_KEY =
      this.configService.get<string>('ADMIN_PRIVATE_KEY')!;
    this.web3 = new Web3(this.RPC_URL);
  }

  generateAddress(): { address: string; privateKey: string } {
    // const account = this.web3.eth.accounts.create();
    // return {
    //   address: account.address,
    //   privateKey: account.privateKey,
    // };
    return {
      address: '0x1234567890123456789012345678901234567890',
      privateKey:
        '0x1234567890123456789012345678901234567890123456789012345678901234',
    };
  }

  validateAddress(address: string): boolean {
    // try {
    //   this.web3.utils.toChecksumAddress(address);
    //   return true;
    // } catch {
    //   return false;
    // }
    return true;
  }

  async getTokenBalance(address: string): Promise<number> {
    try {
      // const contract = new this.web3.eth.Contract(
      //   [
      //     {
      //       constant: true,
      //       inputs: [{ name: '_owner', type: 'address' }],
      //       name: 'balanceOf',
      //       outputs: [{ name: 'balance', type: 'uint256' }],
      //       type: 'function',
      //       stateMutability: 'view',
      //       payable: false,
      //     },
      //   ] as const,
      //   this.TOKEN_ADDRESS,
      // );
      const contract = mockContractResponse;
      const balance = await contract.methods.balanceOf(address).call();
      return Number(balance) / 10 ** 18;
    } catch (error) {
      console.error('Error getting token balance:', error);
      throw error;
    }
  }

  async transferFromFiat(address: string, amount: number): Promise<boolean> {
    try {
      // const contract = new this.web3.eth.Contract(
      //   [
      //     {
      //       constant: false,
      //       inputs: [
      //         { name: 'account', type: 'address' },
      //         { name: 'amount', type: 'uint256' }
      //       ],
      //       name: 'transferFromFiat',
      //       outputs: [],
      //       type: 'function',
      //       stateMutability: 'nonpayable',
      //       payable: false
      //     }
      //   ] as const,
      //   this.TOKEN_ADDRESS
      // );

      // const amountWithFee = BigInt(Math.floor(amount * 10 ** 18 * (1 - this.PLATFORM_FEE)));
      // const data = contract.methods.transferFromFiat(address, amountWithFee).encodeABI();

      // const tx = {
      //   from: this.ADMIN_ADDRESS,
      //   to: this.TOKEN_ADDRESS,
      //   gas: '1000000',
      //   data: data
      // };

      // const signedTx = await this.web3.eth.accounts.signTransaction(tx, this.ADMIN_PRIVATE_KEY);
      // const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);

      // return receipt.status === BigInt(1);
      const contract = mockContractResponse;
      const amountWithFee = BigInt(
        Math.floor(amount * 10 ** 18 * (1 - this.PLATFORM_FEE)),
      );
      return true;
    } catch (error) {
      console.error('Error in transferFromFiat:', error);
      throw error;
    }
  }

  async transferToFiat(
    address: string,
    amount: number,
    userPrivateKey: string,
  ): Promise<boolean> {
    try {
      // const contract = new this.web3.eth.Contract(
      //   [
      //     {
      //       constant: false,
      //       inputs: [
      //         { name: 'account', type: 'address' },
      //         { name: 'amount', type: 'uint256' },
      //       ],
      //       name: 'transferToFiat',
      //       outputs: [],
      //       type: 'function',
      //       stateMutability: 'nonpayable',
      //       payable: false,
      //     },
      //   ] as const,
      //   this.TOKEN_ADDRESS,
      // );

      // const amountWithFee = BigInt(Math.floor(amount * 10 ** 18));
      // const data = contract.methods.transferToFiat(address, amountWithFee).encodeABI();

      // const tx = {
      //   from: this.ADMIN_ADDRESS,
      //   to: this.TOKEN_ADDRESS,
      //   gas: '1000000',
      //   data: data
      // };

      // const signedTx = await this.web3.eth.accounts.signTransaction(tx, userPrivateKey);
      // const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);

      // return receipt.status === BigInt(1);
      const contract = mockContractResponse;
      const amountWithFee = BigInt(Math.floor(amount * 10 ** 18));
      return true;
    } catch (error) {
      console.error('Error in transferToFiat:', error);
      throw error;
    }
  }

  async transfer(
    address: string,
    amount: number,
    userPrivateKey: string,
  ): Promise<boolean> {
    try {
      // const contract = new this.web3.eth.Contract(
      //   [
      //     {
      //       constant: false,
      //       inputs: [
      //         { name: 'to', type: 'address' },
      //         { name: 'amount', type: 'uint256' },
      //       ],
      //       name: 'transfer',
      //       outputs: [],
      //       type: 'function',
      //       stateMutability: 'nonpayable',
      //       payable: false,
      //     },
      //   ] as const,
      //   this.TOKEN_ADDRESS,
      // );

      // const amountWithFee = BigInt(Math.floor(amount * 10 ** 18));
      // const data = contract.methods.transfer(address, amountWithFee).encodeABI();

      // const tx = {
      //   from: this.ADMIN_ADDRESS,
      //   to: this.TOKEN_ADDRESS,
      //   gas: '1000000',
      //   data: data
      // };

      // const signedTx = await this.web3.eth.accounts.signTransaction(tx, userPrivateKey);
      // const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);

      // return receipt.status === BigInt(1);
      const contract = mockContractResponse;
      const amountWithFee = BigInt(Math.floor(amount * 10 ** 18));
      return true;
    } catch (error) {
      console.error('Error in transfer:', error);
      throw error;
    }
  }
}
