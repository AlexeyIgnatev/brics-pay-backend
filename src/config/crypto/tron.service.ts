import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import * as TronWeb from 'tronweb';

const TRON_SUN = 1_000_000;
const ACCOUNT_BOOTSTRAP_SUN = 1_000_000;
const TRON_RPC_TIMEOUT_MS = 120_000;
const TRON_TX_EXPIRATION_MS = 15 * 60 * 1000;

@Injectable()
export class TronService {
  private tron: any;
  private readonly decimalsDefault: number;
  private readonly logger = new Logger(TronService.name);

  private buildNodeProviders(
    fullNode: string,
    solidityNode: string,
    eventServer: string,
    headers: Record<string, string>,
  ): {
    fullNodeProvider: any;
    solidityNodeProvider: any;
    eventServerProvider: any;
  } {
    const HttpProvider = (TronWeb as any).providers?.HttpProvider;
    if (!HttpProvider) {
      return {
        fullNodeProvider: fullNode,
        solidityNodeProvider: solidityNode,
        eventServerProvider: eventServer,
      };
    }

    return {
      fullNodeProvider: new HttpProvider(fullNode, TRON_RPC_TIMEOUT_MS, '', '', headers),
      solidityNodeProvider: new HttpProvider(
        solidityNode,
        TRON_RPC_TIMEOUT_MS,
        '',
        '',
        headers,
      ),
      eventServerProvider: new HttpProvider(
        eventServer,
        TRON_RPC_TIMEOUT_MS,
        '',
        '',
        headers,
      ),
    };
  }

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
    const nodeProviders = this.buildNodeProviders(
      fullNode,
      solidityNode,
      eventServer,
      headers,
    );

    const TronCtor = TronWeb.TronWeb || TronWeb;
    this.tron = new TronCtor({
      fullNode: nodeProviders.fullNodeProvider,
      solidityNode: nodeProviders.solidityNodeProvider,
      eventServer: nodeProviders.eventServerProvider,
    });

    this.decimalsDefault =
      Number(this.config.get<number>('TRON_USDT_DECIMALS')) || 6;
  }

  private getTronWebCtor(): new (options: {
    fullNode?: any;
    fullHost?: any;
    privateKey?: string;
    headers?: Record<string, string>;
    solidityNode?: any;
    eventServer?: any;
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
      fullNode?: any;
      fullHost?: any;
      privateKey?: string;
      headers?: Record<string, string>;
      solidityNode?: any;
      eventServer?: any;
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
    const nodeProviders = this.buildNodeProviders(
      fullNode,
      solidityNode,
      eventServer,
      headers,
    );

    const TronCtor = this.getTronWebCtor();
    return new TronCtor({
      fullNode: nodeProviders.fullNodeProvider,
      solidityNode: nodeProviders.solidityNodeProvider,
      eventServer: nodeProviders.eventServerProvider,
      privateKey,
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

  private readSecretFromFile(
    envKey: string,
    defaultPath?: string,
  ): string | undefined {
    const configuredPath = this.config.get<string>(envKey)?.trim();
    const path = configuredPath || defaultPath;
    if (!path || !existsSync(path)) {
      return undefined;
    }

    const value = readFileSync(path, 'utf8').trim();
    return value || undefined;
  }

  private getTreasuryPrivateKey(): string | undefined {
    return (
      this.config.get<string>('USDT_TREASURY_PRIVATE_KEY')?.trim() ||
      this.readSecretFromFile(
        'USDT_TREASURY_PRIVATE_KEY_FILE',
        '/run/secrets/usdt_treasury_private_key',
      )
    );
  }

  async getAccount(address: string): Promise<Record<string, unknown>> {
    const fullNode = this.getTronWeb().fullNode;
    const toHex = this.getTronWeb().address.toHex(address);
    return fullNode.request('wallet/getaccount', { address: toHex }, 'post');
  }

  private async waitForAccountActivation(
    address: string,
    minBalance = 0,
    timeoutMs = 15_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const account = await this.getAccount(address);
        const balance =
          Number((account as { balance?: unknown }).balance ?? 0) || 0;
        if (account && Object.keys(account).length > 0 && balance >= minBalance) {
          return;
        }
      } catch {
        // keep polling
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new BadRequestException(
      `Failed to activate TRON account ${address} on chain`,
    );
  }

  async bootstrapAccount(address: string): Promise<void> {
    const account = await this.getAccount(address).catch(() => ({}));
    const balance = Number((account as { balance?: unknown }).balance ?? 0) || 0;
    const treasuryPrivateKey = this.getTreasuryPrivateKey();
    if (!treasuryPrivateKey) {
      if (Object.keys(account).length > 0) return;
      throw new BadRequestException(
        `TRON account ${address} does not exist and treasury private key is not configured`,
      );
    }

    const bootstrapTron = this.getTronWeb(treasuryPrivateKey);
    const treasuryAddress = bootstrapTron.address.fromPrivateKey(treasuryPrivateKey);
    const targetBalance = ACCOUNT_BOOTSTRAP_SUN;
    if (balance >= targetBalance) {
      return;
    }

    const topUpAmount = targetBalance - balance;
    this.logger.warn(
      `[account-bootstrap] funding browser wallet address=${address} amountSun=${topUpAmount} payer=${treasuryAddress}`,
    );
    const funding = await bootstrapTron.trx.sendTransaction(address, topUpAmount, {
      privateKey: treasuryPrivateKey,
      address: treasuryAddress,
    });
    if ((funding as { code?: string }).code) {
      throw new BadRequestException(
        `TRON account funding failed: ${String((funding as { code?: string; message?: string }).code)} ${String((funding as { code?: string; message?: string }).message ?? '')}`.trim(),
      );
    }
    await this.waitForAccountActivation(address, ACCOUNT_BOOTSTRAP_SUN);
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
    this.logger.verbose(
      `[getTrc20Balance] start address=${address} contract=${contract} decimals=${decimals}`,
    );
    try {
      const response = await this.tron.transactionBuilder.triggerConstantContract(
        contract,
        'balanceOf(address)',
        {
          feeLimit: 1_000_000,
          callValue: 0,
        },
        [{ type: 'address', value: address }],
        address,
      );
      const responseObject = response as Record<string, unknown>;
      const constantResult = (response as { constant_result?: unknown[] })
        .constant_result;
      this.logger.verbose(
        `[getTrc20Balance] direct constant response address=${address} contract=${contract} hasResult=${Boolean(responseObject.result)} constantResultCount=${Array.isArray(constantResult) ? constantResult.length : 0} txKeys=${Object.keys(responseObject).join(',')}`,
      );
      const rawResult =
        constantResult?.[0] ?? null;
      if (rawResult == null) {
        throw new Error(`Invalid TRC20 constant response: ${JSON.stringify(response)}`);
      }
      const raw =
        typeof rawResult === 'object' && rawResult && 'toString' in rawResult
          ? rawResult.toString()
          : String(rawResult);
      const balance = Number(BigInt(`0x${raw.replace(/^0x/, '')}`)) / 10 ** decimals;
      this.logger.verbose(
        `[getTrc20Balance] direct constant parsed address=${address} contract=${contract} raw=${raw} balance=${balance}`,
      );
      return balance;
    } catch (error) {
      this.logger.warn(
        `[getTrc20Balance] direct constant call failed address=${address} contract=${contract}: ${error instanceof Error ? error.message : String(error)}`,
      );
      const ctr = await this.tron.contract().at(contract);
      const res = await ctr.balanceOf(address).call({
        from: address,
        feeLimit: 1_000_000,
        callValue: 0,
      });
      this.logger.verbose(
        `[getTrc20Balance] fallback contract call address=${address} contract=${contract} payload=${JSON.stringify(res)}`,
      );
      const raw =
        typeof res === 'object' && 'toString' in res
          ? res.toString()
          : String(res);
      const denom = 10 ** decimals;
      const balance = Number(raw) / denom;
      this.logger.verbose(
        `[getTrc20Balance] fallback parsed address=${address} contract=${contract} raw=${raw} balance=${balance}`,
      );
      return balance;
    }
  }

  async sendTrc20(params: {
    fromPrivateKey: string;
    toAddress: string;
    amount: number;
    tokenAddress?: string;
    feeLimit?: number;
  }): Promise<{ txHash: string }> {
    const privateKey = this.normalizePrivateKey(params.fromPrivateKey);
    const tokenAddress = this.getTokenAddress(params.tokenAddress);
    const tron = this.getTronWeb(privateKey);
    const fromAddress = tron.address.fromPrivateKey(privateKey);
    const feeLimit = params.feeLimit ?? 100_000_000;

    this.logger.verbose(
      `[sendTrc20] start from=${fromAddress} to=${params.toAddress} token=${tokenAddress} amount=${params.amount} feeLimit=${feeLimit} rpc=${this.config.get<string>('TRON_FULL_NODE') || 'https://api.trongrid.io'}`,
    );

    const amountSun = BigInt(
      Math.floor(Number(params.amount) * 10 ** this.decimalsDefault),
    );
    if (!(amountSun > 0n)) {
      throw new BadRequestException('USDT amount must be greater than 0');
    }

    try {
      const currentBlock = await tron.trx.getCurrentBlock();
      const blockHeader = currentBlock?.block_header?.raw_data
        ? {
            ref_block_bytes: String(
              currentBlock.block_header.raw_data.number.toString(16),
            )
              .slice(-4)
              .padStart(4, '0'),
            ref_block_hash: String(currentBlock.blockID).slice(16, 32),
            timestamp: Number(currentBlock.block_header.raw_data.timestamp),
            expiration:
              Number(currentBlock.block_header.raw_data.timestamp) +
              TRON_TX_EXPIRATION_MS,
          }
        : undefined;

      this.logger.verbose(
        `[sendTrc20] build triggerSmartContract from=${fromAddress} to=${params.toAddress} amountSun=${amountSun.toString()} expirationMs=${TRON_TX_EXPIRATION_MS} block=${String(currentBlock?.block_header?.raw_data?.number ?? 'null')}`,
      );
      const tx = await tron.transactionBuilder.triggerSmartContract(
        tokenAddress,
        'transfer(address,uint256)',
        { feeLimit, callValue: 0, blockHeader },
        [
          { type: 'address', value: params.toAddress },
          { type: 'uint256', value: amountSun.toString() },
        ],
        fromAddress,
      );

      if (!tx?.transaction || !tx?.result?.result) {
        throw new BadRequestException(
          `Failed to build TRC20 transfer: ${JSON.stringify(tx)}`,
        );
      }

      this.logger.verbose(
        `[sendTrc20] sign transaction from=${fromAddress} txID=${tx.transaction.txID} expiration=${String(tx.transaction.raw_data?.expiration ?? 'null')}`,
      );
      const signedTransaction = await tron.trx.sign(
        tx.transaction,
        privateKey,
      );
      if (!signedTransaction.signature?.length) {
        throw new BadRequestException('Failed to sign TRC20 transfer');
      }

      this.logger.verbose(
        `[sendTrc20] broadcast transaction from=${fromAddress} txID=${signedTransaction.txID}`,
      );
      const broadcast = await tron.trx.sendRawTransaction(signedTransaction);
      if (!broadcast || typeof broadcast !== 'object') {
        throw new BadRequestException('Failed to broadcast TRC20 transfer');
      }
      if ((broadcast as { code?: string }).code) {
        const code = String((broadcast as { code?: string }).code);
        const message = String(
          (broadcast as { message?: string }).message ?? '',
        );
        throw new BadRequestException(
          `TRC20 broadcast rejected: ${code} ${message}`.trim(),
        );
      }

      const txHash = String(signedTransaction.txID);
      this.logger.verbose(
        `[sendTrc20] broadcasted txHash=${txHash} amountSun=${amountSun.toString()} token=${tokenAddress}`,
      );

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

      try {
        const acceptedTx = await this.getTronWeb().trx.getTransaction(txHash);
        if (
          acceptedTx &&
          typeof acceptedTx === 'object' &&
          Object.keys(acceptedTx).length > 0
        ) {
          this.logger.verbose(
            `[waitForTransaction] accepted txHash=${txHash} payload=${JSON.stringify(acceptedTx)}`,
          );
          return acceptedTx as Record<string, unknown>;
        }
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
