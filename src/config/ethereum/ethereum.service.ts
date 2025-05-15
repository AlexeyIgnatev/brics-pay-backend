import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Web3 from 'web3';

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

      this.logger.log('Transaction params:', tx);

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

      return (
        receipt.status === '0x1' ||
        receipt.status === 1 ||
        receipt.status === 1n
      );
    } catch (error) {
      this.logger.error('Error in transferFromFiat:', error);
      throw error;
    }
  }

  async transferToFiat(
    address: string,
    amount: number,
    userPrivateKey: string
  ): Promise<boolean> {
    try {
      const contract = new this.web3.eth.Contract(
        [
          {
            constant: false,
            inputs: [
              { name: 'amount', type: 'uint256' },
            ],
            name: 'transferToFiat',
            outputs: [{ name: '', type: 'bool' }],
            type: 'function',
            stateMutability: 'nonpayable',
            payable: false,
          },
        ] as const,
        this.TOKEN_ADDRESS,
      );

      const userAccount = this.web3.eth.accounts.privateKeyToAccount(userPrivateKey);
      if (userAccount.address.toLowerCase() !== address.toLowerCase()) {
        throw new Error('Private key does not match sender address');
      }

      const amountWithFee = BigInt(Math.floor(amount * 10 ** 18));
      const data = contract.methods.transferToFiat(amountWithFee).encodeABI();

      await this.fundUserWalletIfNeeded(
        userAccount.address,
        data,
        this.ADMIN_PRIVATE_KEY,
      );

      const nonce = await this.web3.eth.getTransactionCount(userAccount.address);
      const gasEstimate = await this.web3.eth.estimateGas({
        from: userAccount.address,
        to: this.TOKEN_ADDRESS,
        data: data,
      });
      const gasPrice = await this.web3.eth.getGasPrice();
      const gasPriceWithMargin = Math.floor(Number(gasPrice) * 1.1);
      const chainId = await this.web3.eth.getChainId();

      const tx = {
        from: userAccount.address,
        to: this.TOKEN_ADDRESS,
        gas: gasEstimate,
        gasPrice: this.web3.utils.toHex(gasPriceWithMargin),
        data: data,
        nonce: this.web3.utils.toHex(nonce),
        chainId: this.web3.utils.toHex(chainId),
      };

      this.logger.log('Transaction params:', tx);

      const signedTx = await this.web3.eth.accounts.signTransaction(tx, userPrivateKey);
      if (!signedTx.rawTransaction) {
        throw new Error('Failed to sign user transaction');
      }

      const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);
      this.logger.log('Transaction receipt:', receipt);

      return (
        receipt.status === '0x1' ||
        receipt.status === 1 ||
        receipt.status === 1n
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

      const account =
        this.web3.eth.accounts.privateKeyToAccount(userPrivateKey);

      const amountWithFee = BigInt(Math.floor(amount * 10 ** 18));
      const data = contract.methods
        .transfer(address, amountWithFee)
        .encodeABI();

      const nonce = await this.web3.eth.getTransactionCount(account.address);
      const chainId = await this.web3.eth.getChainId();

      const fee = await this.web3.eth.getGasPrice();
      const increasedFee = Math.floor(Number(fee) * 1.1);

      const tx = {
        from: account.address,
        to: this.TOKEN_ADDRESS,
        gas: '1000000',
        gasPrice: this.web3.utils.toHex(increasedFee),
        data: data,
        nonce: this.web3.utils.toHex(nonce),
        chainId: this.web3.utils.toHex(chainId),
      };

      this.logger.log('Transaction params:', tx);

      const signedTx = await this.web3.eth.accounts.signTransaction(
        tx,
        userPrivateKey,
      );
      const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);
      this.logger.log('receipt', receipt);

      return (
        receipt.status === '0x1' ||
        receipt.status === 1 ||
        receipt.status === 1n
      );
    } catch (error) {
      this.logger.error('Error in transfer:', error);
      throw error;
    }
  }

  private async fundUserWalletIfNeeded(
    userAddress: string,
    contractCallData: string,
    fundPrivateKey: string,
  ): Promise<void> {
    const fundAccount = this.web3.eth.accounts.privateKeyToAccount(fundPrivateKey);
    const gasEstimate = await this.web3.eth.estimateGas({
      from: userAddress,
      to: this.TOKEN_ADDRESS,
      data: contractCallData,
    });

    const gasPrice = await this.web3.eth.getGasPrice();
    const gasPriceWithMargin = Math.floor(Number(gasPrice) * 1.1);
    const requiredBalance = BigInt(gasEstimate) * BigInt(gasPriceWithMargin);

    const currentBalance = BigInt(await this.web3.eth.getBalance(userAddress));
    if (currentBalance >= requiredBalance) {
      this.logger.log(`User wallet has sufficient balance: ${currentBalance}`);
      return;
    }

    const amountToSend = requiredBalance - currentBalance;
    const chainId = await this.web3.eth.getChainId();
    const nonce = await this.web3.eth.getTransactionCount(fundAccount.address);

    const tx = {
      from: fundAccount.address,
      to: userAddress,
      value: this.web3.utils.toHex(amountToSend.toString()),
      gas: 21000,
      gasPrice: this.web3.utils.toHex(gasPriceWithMargin),
      nonce: this.web3.utils.toHex(nonce),
      chainId: this.web3.utils.toHex(chainId),
    };

    const signedTx = await this.web3.eth.accounts.signTransaction(tx, fundPrivateKey);
    if (!signedTx.rawTransaction) {
      throw new Error('Failed to sign fund transfer transaction');
    }

    const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    this.logger.log('Funding transaction receipt:', receipt);

    // Опциональное ожидание поступления средств
    const start = Date.now();
    let updatedBalance = BigInt(await this.web3.eth.getBalance(userAddress));
    while (updatedBalance < requiredBalance) {
      if (Date.now() - start > 10000) throw new Error('Timeout waiting for user funding');
      await new Promise((r) => setTimeout(r, 1000));
      updatedBalance = BigInt(await this.web3.eth.getBalance(userAddress));
    }

    this.logger.log(`User wallet funded successfully. Balance: ${updatedBalance}`);
  }
}
