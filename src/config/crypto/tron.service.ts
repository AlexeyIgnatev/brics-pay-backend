import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as TronWeb from 'tronweb';

@Injectable()
export class TronService {
  private tron: any;
  private readonly decimalsDefault: number;

  constructor(private readonly config: ConfigService) {
    const fullNode = this.config.get<string>('TRON_FULL_NODE') || 'https://api.trongrid.io';
    const solidityNode = this.config.get<string>('TRON_SOLIDITY_NODE') || fullNode;
    const eventServer = this.config.get<string>('TRON_EVENT_SERVER') || fullNode;
    const apiKey = this.config.get<string>('TRON_API_KEY');

    const headers: any = {};
    if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;

    const TronCtor = (TronWeb).TronWeb || (TronWeb);
    this.tron = new TronCtor({
      fullHost: fullNode,
      headers,
      solidityNode,
      eventServer,
    });

    this.decimalsDefault = Number(this.config.get<number>('TRON_USDT_DECIMALS')) || 6;
  }

  async getTrc20Balance(address: string, contract: string, decimals = this.decimalsDefault): Promise<number> {
    const ctr = await this.tron.contract().at(contract);
    const res = await ctr.balanceOf(address).call();
    const raw = typeof res === 'object' && 'toString' in res ? (res).toString() : String(res);
    const denom = 10 ** decimals;
    return Number(raw) / denom;
  }
}
