import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as TronWeb from 'tronweb';

const TRON_SUN = 1_000_000;

@Injectable()
export class TronService {
  private tron: any;
  private readonly decimalsDefault: number;
  private readonly logger = new Logger(TronService.name);

  constructor(private readonly config: ConfigService) {
    const fullNode =
      this.config.get<string>('TRON_FULL_NODE') || 'https://api.trongrid.io';
    const solidityNode =
      this.config.get<string>('TRON_SOLIDITY_NODE') || fullNode;
    const eventServer =
      this.config.get<string>('TRON_EVENT_SERVER') || fullNode;
    const apiKey = this.config.get<string>('TRON_API_KEY');

    const headers: any = {};
    if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;

    const TronCtor = TronWeb.TronWeb || TronWeb;
    this.tron = new TronCtor({
      fullHost: fullNode,
      headers,
      solidityNode,
      eventServer,
    });

    this.decimalsDefault =
      Number(this.config.get<number>('TRON_USDT_DECIMALS')) || 6;
  }

  private getTronWebCtor(): new (options: {
    fullHost: string;
    privateKey?: string;
    headers?: Record<string, string>;
    solidityNode?: string;
    eventServer?: string;
  }) => any {
    const candidate =
      (TronWeb as { TronWeb?: unknown }).TronWeb ??
      (TronWeb as { default?: { TronWeb?: unknown } }).default?.TronWeb ??
      (TronWeb as { default?: unknown }).default ??
      TronWeb;

    if (typeof candidate !== 'function') {
      throw new BadRequestException('TronWeb constructor is unavailable');
    }

    return candidate as new (options: {
      fullHost: string;
      privateKey?: string;
      headers?: Record<string, string>;
      solidityNode?: string;
      eventServer?: string;
    }) => any;
  }

  private getTronWeb(privateKey?: string): any {
    const fullNode =
      this.config.get<string>('TRON_FULL_NODE') || 'https://api.trongrid.io';
    const solidityNode =
      this.config.get<string>('TRON_SOLIDITY_NODE') || fullNode;
    const eventServer =
      this.config.get<string>('TRON_EVENT_SERVER') || fullNode;
    const apiKey = this.config.get<string>('TRON_API_KEY');

    const headers: Record<string, string> = {};
    if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;

    const TronCtor = this.getTronWebCtor();
    return new TronCtor({
      fullHost: fullNode,
      privateKey,
      headers,
      solidityNode,
      eventServer,
    });
  }

  private getTokenAddress(tokenAddress?: string): string {
    const resolved =
      tokenAddress ||
      this.config.get<string>('USDT_TOKEN_ADDRESS') ||
      this.config.get<string>('TRON_USDT_CONTRACT');
    if (!resolved?.trim()) {
      throw new BadRequestException('USDT token contract is not configured');
    }
    return resolved.trim();
  }

  private isEmptyContractPayload(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') return true;
    return Object.keys(payload as Record<string, unknown>).length === 0;
  }

  async assertTokenContractLive(tokenAddress?: string): Promise<string> {
    const resolved = this.getTokenAddress(tokenAddress);

    try {
      const contract = await this.getTronWeb().trx.getContract(resolved);
      if (this.isEmptyContractPayload(contract)) {
        throw new BadRequestException(
          `USDT token contract is not live on this node: ${resolved}`,
        );
      }
      return resolved;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        `USDT token contract is not live on this node: ${resolved}`,
      );
    }
  }

  private normalizePrivateKey(privateKey: string): string {
    let pk = privateKey.trim();
    if (pk.startsWith('0x') || pk.startsWith('0X')) {
      pk = pk.slice(2);
    }
    if (!/^[0-9a-fA-F]{64}$/.test(pk)) {
      throw new BadRequestException(
        'Invalid private key: expected 32-byte hex (64 chars).',
      );
    }
    return pk.toLowerCase();
  }

  async getTrc20Balance(
    address: string,
    contract: string,
    decimals = this.decimalsDefault,
  ): Promise<number> {
    await this.assertTokenContractLive(contract);
    const ctr = await this.tron.contract().at(contract);
    const res = await ctr.balanceOf(address).call();
    const raw =
      typeof res === 'object' && 'toString' in res
        ? res.toString()
        : String(res);
    const denom = 10 ** decimals;
    return Number(raw) / denom;
  }

  async sendTrc20(params: {
    fromPrivateKey: string;
    toAddress: string;
    amount: number;
    tokenAddress?: string;
    feeLimit?: number;
  }): Promise<{ txHash: string }> {
    const privateKey = this.normalizePrivateKey(params.fromPrivateKey);
    const tokenAddress = await this.assertTokenContractLive(params.tokenAddress);
    const tron = this.getTronWeb(privateKey);
    const fromAddress = tron.address.fromPrivateKey(privateKey);
    const feeLimit = params.feeLimit ?? 100_000_000;

    this.logger.verbose(
      `[sendTrc20] start from=${fromAddress} to=${params.toAddress} token=${tokenAddress} amount=${params.amount} feeLimit=${feeLimit} rpc=${this.config.get<string>('TRON_FULL_NODE') || 'https://api.trongrid.io'}`,
    );

    const contract = tron.contract(
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
      ],
      tokenAddress,
    );

    const amountSun = BigInt(
      Math.floor(Number(params.amount) * 10 ** this.decimalsDefault),
    );
    if (!(amountSun > 0n)) {
      throw new BadRequestException('USDT amount must be greater than 0');
    }

    try {
      const txHash = await contract
        .transfer(params.toAddress, amountSun.toString())
        .send(
          {
            feeLimit,
            shouldPollResponse: false,
          },
          privateKey,
        );

      if (!txHash || typeof txHash !== 'string') {
        throw new BadRequestException('Failed to broadcast TRC20 transfer');
      }

      this.logger.verbose(`[sendTrc20] broadcasted txHash=${txHash}`);

      return { txHash };
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[sendTrc20] failed from=${fromAddress} to=${params.toAddress} token=${tokenAddress} amount=${params.amount}: ${details}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadRequestException(`TRC20 broadcast failed: ${details}`);
    }
  }

  async waitForTransaction(
    txHash: string,
    timeoutMs = 120_000,
    pollMs = 2_000,
  ): Promise<Record<string, unknown> | null> {
    const deadline = Date.now() + timeoutMs;
    this.logger.verbose(
      `[waitForTransaction] start txHash=${txHash} timeoutMs=${timeoutMs} pollMs=${pollMs}`,
    );
    while (Date.now() < deadline) {
      try {
        const info = await this.getTronWeb().trx.getTransactionInfo(txHash);
        if (
          info &&
          typeof info === 'object' &&
          (Number((info as { blockNumber?: number }).blockNumber ?? 0) > 0 ||
            (info as { receipt?: { result?: string } }).receipt?.result ===
              'SUCCESS')
        ) {
          this.logger.verbose(
            `[waitForTransaction] confirmed txHash=${txHash} blockNumber=${String((info as { blockNumber?: number }).blockNumber ?? 0)} status=${
              (info as { receipt?: { result?: string } }).receipt?.result ??
              'UNKNOWN'
            }`,
          );
          return info as Record<string, unknown>;
        }
        this.logger.verbose(
          `[waitForTransaction] pending txHash=${txHash} payload=${JSON.stringify(info)}`,
        );
      } catch {
        // keep polling
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    this.logger.warn(`[waitForTransaction] timeout txHash=${txHash}`);
    return null;
  }

  async getTransactionInfo(txHash: string): Promise<Record<string, unknown> | null> {
    try {
      const info = await this.getTronWeb().trx.getTransactionInfo(txHash);
      this.logger.verbose(
        `[getTransactionInfo] txHash=${txHash} payload=${JSON.stringify(info)}`,
      );
      return info && typeof info === 'object'
        ? (info as Record<string, unknown>)
        : null;
    } catch (error) {
      this.logger.warn(
        `[getTransactionInfo] failed txHash=${txHash}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
