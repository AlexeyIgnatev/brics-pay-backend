import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class BitcoinService {
  private readonly apiBase: string;

  constructor(private readonly config: ConfigService) {
    this.apiBase = this.config.get<string>('BTC_API_BASE') || 'https://blockstream.info/api';
  }

  async getBtcBalance(address: string): Promise<number> {
    // Using Blockstream API: /address/:address
    const url = `${this.apiBase}/address/${address}`;
    const { data } = await axios.get(url);
    // data.chain_stats.funded_txo_sum - spent_txo_sum
    const funded = Number(data.chain_stats.funded_txo_sum || 0);
    const spent = Number(data.chain_stats.spent_txo_sum || 0);
    const memFunded = Number(data.mempool_stats?.funded_txo_sum || 0);
    const memSpent = Number(data.mempool_stats?.spent_txo_sum || 0);
    const satoshis = funded - spent + memFunded - memSpent;
    return satoshis / 1e8;
  }
}
