import { BadRequestException, Injectable } from '@nestjs/common';

import * as Ethers from 'ethers';
import * as TronWeb from 'tronweb';

@Injectable()
export class CryptoService {
  private normalizeHexPriv(priv: string): string {
    let hex = priv.trim();
    if (hex.startsWith('0x') || hex.startsWith('0X')) hex = hex.slice(2);
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new BadRequestException(
        'Invalid private key: expected 32-byte hex (64 chars).',
      );
    }
    return hex.toLowerCase();
  }

  ethAddressFromPrivateKey(priv: string): string {
    const pk = this.normalizeHexPriv(priv);
    const wallet = new Ethers.Wallet('0x' + pk);
    return wallet.address;
  }

  trxAddressFromPrivateKey(priv: string): string {
    const pk = this.normalizeHexPriv(priv);
    return TronWeb.TronWeb.address.fromPrivateKey(pk) as string;
  }
}
