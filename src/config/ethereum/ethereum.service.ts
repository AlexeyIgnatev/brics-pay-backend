import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Web3, { TransactionReceipt } from 'web3';
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
  private readonly logger = new Logger(EthereumService.name);

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
    const account = this.web3.eth.accounts.create();
    this.logger.log(`Generated address: ${account.address}`);
    this.logger.log(`Generated private key: ${account.privateKey}`);
    return {
      address: account.address,
      privateKey: account.privateKey,
    };
  }

  validateAddress(address: string): boolean {
    try {
      this.web3.utils.toChecksumAddress(address);
      this.logger.log(`Validated address: ${address}`);
      return true;
    } catch {
      this.logger.error(`Invalid address: ${address}`);
      return false;
    }
  }

  async getTokenBalance(address: string): Promise<number> {
    try {
      const contract = new this.web3.eth.Contract(
        [
          {
            constant: true,
            inputs: [{ name: '_owner', type: 'address' }],
            name: 'balanceOf',
            outputs: [{ name: 'balance', type: 'uint256' }],
            type: 'function',
            stateMutability: 'view',
            payable: false,
          },
        ] as const,
        this.TOKEN_ADDRESS,
      );
      const balance = await contract.methods.balanceOf(address).call();
      this.logger.log(`Token balance: ${balance}`);
      return Number(balance) / 10 ** 18;
    } catch (error) {
      this.logger.error('Error getting token balance:', error);
      throw error;
    }
  }

  async getTransactionReceipt(txHash: string): Promise<TransactionReceipt> {
    let attempts = 0;
    const maxAttempts = 10;
    const delay = 2000; // 2 секунды

    while (attempts < maxAttempts) {
      const receipt = await this.web3.eth.getTransactionReceipt(txHash);
      if (receipt) {
        return receipt;
      }

      this.logger.log(
        `Waiting for transaction confirmation... Attempt ${attempts + 1}/${maxAttempts}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempts++;
    }

    throw new Error('Transaction not found after multiple attempts');
  }

  async transferFromFiat(address: string, amount: number): Promise<boolean> {
    try {
      const contract = new this.web3.eth.Contract(
        [
          {
            constant: false,
            inputs: [
              { name: 'account', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
            name: 'transferFromFiat',
            outputs: [{ name: '', type: 'bool' }],
            type: 'function',
            stateMutability: 'nonpayable',
            payable: false,
          },
        ],
        this.TOKEN_ADDRESS,
      );

      const amountWithFee = BigInt(
        Math.floor(amount * 10 ** 18 * (1 - this.PLATFORM_FEE)),
      );

      const data = contract.methods
        .transferFromFiat(address, amountWithFee.toString())
        .encodeABI();

      const nonce = await this.web3.eth.getTransactionCount(
        this.ADMIN_ADDRESS,
        'latest',
      );
      const chainId = await this.web3.eth.getChainId();

      const account = this.web3.eth.accounts.privateKeyToAccount(
        this.ADMIN_PRIVATE_KEY,
      );
      if (account.address.toLowerCase() !== this.ADMIN_ADDRESS.toLowerCase()) {
        throw new Error('Private key does not match admin address');
      }

      const fee = await this.web3.eth.getGasPrice();
      const increasedFee = Math.floor(Number(fee) * 1.1);
      const tx = {
        from: account.address,
        to: this.TOKEN_ADDRESS,
        gas: '1000000',
        gasPrice: this.web3.utils.toHex(increasedFee),
        data,
        nonce: this.web3.utils.toHex(nonce),
        chainId: this.web3.utils.toHex(chainId),
      };

      this.logger.log('Transaction params:', {
        from: account.address,
        to: this.TOKEN_ADDRESS,
        gas: '1000000',
        gasPrice: this.web3.utils.toHex(increasedFee),
        dataLength: data.length,
        nonce: this.web3.utils.toHex(nonce),
        chainId: this.web3.utils.toHex(chainId),
      });

      const signedTx = await this.web3.eth.accounts.signTransaction(
        tx,
        this.ADMIN_PRIVATE_KEY,
      );
      if (!signedTx.rawTransaction) {
        throw new Error('Failed to sign transaction');
      }

      const receipt = await this.web3.eth.sendSignedTransaction(
        signedTx.rawTransaction,
      );
      this.logger.log('receipt', receipt);
      this.logger.log('Transaction sent, hash:', signedTx.transactionHash);

      const receiptStatus = await this.getTransactionReceipt(
        signedTx.transactionHash,
      );
      this.logger.log('Transaction receipt:', receiptStatus);

      return (
        receiptStatus.status === '0x1' ||
        receiptStatus.status === 1 ||
        receiptStatus.status === 1n
      );
    } catch (error) {
      this.logger.error('Error in transferFromFiat:', error);
      throw error;
    }
  }

  async transferToFiat(
    address: string,
    amount: number,
    userPrivateKey: string,
  ): Promise<boolean> {
    try {
      const contract = new this.web3.eth.Contract(
        [
          {
            constant: false,
            inputs: [
              { name: 'account', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
            name: 'transferToFiat',
            outputs: [],
            type: 'function',
            stateMutability: 'nonpayable',
            payable: false,
          },
        ] as const,
        this.TOKEN_ADDRESS,
      );

      const account =
        this.web3.eth.accounts.privateKeyToAccount(userPrivateKey);
      if (account.address.toLowerCase() !== address.toLowerCase()) {
        throw new Error('Private key does not match sender address');
      }
      const amountWithFee = BigInt(Math.floor(amount * 10 ** 18));
      const data = contract.methods
        .transferToFiat(address, amountWithFee)
        .encodeABI();
      const nonce = await this.web3.eth.getTransactionCount(account.address);
      const chainId = await this.web3.eth.getChainId();

      const fee = await this.web3.eth.getGasPrice();
      const increasedFee = Math.floor(Number(fee) * 1.1);
      const tx = {
        from: this.ADMIN_ADDRESS,
        to: this.TOKEN_ADDRESS,
        gas: '1000000',
        gasPrice: this.web3.utils.toHex(increasedFee),
        data: data,
        nonce: this.web3.utils.toHex(nonce),
        chainId: this.web3.utils.toHex(chainId),
      };

      const signedTx = await this.web3.eth.accounts.signTransaction(
        tx,
        userPrivateKey,
      );
      if (!signedTx.rawTransaction) {
        throw new Error('Failed to sign transaction');
      }
      this.logger.log('Signed tx:', signedTx);
      await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);

      const receiptStatus = await this.getTransactionReceipt(
        signedTx.transactionHash,
      );
      return (
        receiptStatus.status === '0x1' ||
        receiptStatus.status === 1 ||
        receiptStatus.status === 1n
      );
    } catch (error) {
      this.logger.error('Error in transferToFiat:', error);
      throw error;
    }
  }

  async transfer(
    address: string,
    amount: number,
    userPrivateKey: string,
  ): Promise<boolean> {
    try {
      const contract = new this.web3.eth.Contract(
        [
          {
            constant: false,
            inputs: [
              { name: 'to', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
            name: 'transfer',
            outputs: [],
            type: 'function',
            stateMutability: 'nonpayable',
            payable: false,
          },
        ] as const,
        this.TOKEN_ADDRESS,
      );

      const amountWithFee = BigInt(Math.floor(amount * 10 ** 18));
      const data = contract.methods
        .transfer(address, amountWithFee)
        .encodeABI();

      const fee = await this.web3.eth.getGasPrice();
      const increasedFee = Math.floor(Number(fee) * 1.1);
      const tx = {
        from: this.ADMIN_ADDRESS,
        to: this.TOKEN_ADDRESS,
        gas: '1000000',
        gasPrice: this.web3.utils.toHex(increasedFee),
        data: data,
      };

      const signedTx = await this.web3.eth.accounts.signTransaction(
        tx,
        userPrivateKey,
      );
      this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);

      const receiptStatus = await this.getTransactionReceipt(
        signedTx.transactionHash,
      );
      return (
        receiptStatus.status === '0x1' ||
        receiptStatus.status === 1 ||
        receiptStatus.status === 1n
      );
    } catch (error) {
      this.logger.error('Error in transfer:', error);
      throw error;
    }
  }
}
