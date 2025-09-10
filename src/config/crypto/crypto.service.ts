import { Injectable } from '@nestjs/common';

import * as Ethers from 'ethers';
import * as TronWeb from 'tronweb';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory, ECPairInterface } from 'ecpair';

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

@Injectable()
export class CryptoService {

  private normalizeHexPriv(priv: string): string {
    let hex = priv.trim();
    if (hex.startsWith('0x') || hex.startsWith('0X')) hex = hex.slice(2);
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error('Invalid private key: expected 32-byte hex (64 chars).');
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

  btcBech32AddressFromPrivateKey(priv: string): string {
    const pk = Buffer.from(this.normalizeHexPriv(priv), 'hex');
    const keyPair: ECPairInterface = ECPair.fromPrivateKey(pk, { compressed: true });

    const pubkey: Buffer = Buffer.isBuffer(keyPair.publicKey)
      ? (keyPair.publicKey as Buffer)
      : Buffer.from(keyPair.publicKey);

    const { address } = bitcoin.payments.p2wpkh({
      pubkey: pubkey,
      network: bitcoin.networks.bitcoin,
    });
    if (!address) throw new Error('Failed to derive BTC address');
    return address;
  }
}
