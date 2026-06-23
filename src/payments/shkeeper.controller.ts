import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { PrismaClient, TransactionStatus } from '@prisma/client';
import { ShkeeperExchangeService } from '../config/exchange/shkeeper.service';
import { ShkeeperWalletService } from '../config/exchange/shkeeper-wallet.service';

@Controller('shkeeper')
export class ShkeeperController {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly shkeeper: ShkeeperExchangeService,
    private readonly wallets: ShkeeperWalletService,
  ) {}

  @Post('webhook')
  @HttpCode(202)
  async webhook(
    @Body() body: Record<string, any>,
    @Headers('x-shkeeper-timestamp') timestamp?: string,
    @Headers('x-shkeeper-signature') signature?: string,
    @Req() req?: Request & { rawBody?: Buffer },
  ): Promise<{ status: string }> {
    const rawBody = req?.rawBody ?? Buffer.from(JSON.stringify(body));
    if (!this.shkeeper.verifyWebhookSignature(timestamp, signature, rawBody)) {
      return { status: 'ignored' };
    }

    const externalId = body?.external_id?.toString?.() ?? '';
    const txHash = body?.tx_hash?.toString?.()
      || body?.txid?.toString?.()
      || body?.transaction_hash?.toString?.()
      || body?.transactions?.[0]?.txid?.toString?.()
      || '';
    const payoutStatus = String(body?.status ?? '').toUpperCase();

    if (!externalId) {
      return { status: 'ignored' };
    }

    const withdrawId = Number(externalId);
    if (!Number.isFinite(withdrawId)) {
      const maybeCustomerId = externalId.replace(/^customer:/, '');
      const customerId = Number(maybeCustomerId);
      if (Number.isFinite(customerId)) {
        await this.wallets.ensureUsdtWallet(customerId);
      }

      return { status: 'ok' };
    }

    const withdraw = await this.prisma.withdrawRequest.findUnique({
      where: { id: withdrawId },
    });
    if (!withdraw) {
      return { status: 'ignored' };
    }

    const finalStatus = payoutStatus === 'SUCCESS' ? 'SUCCESS' : (payoutStatus === 'FAILED' || payoutStatus === 'ERROR' ? 'FAILED' : 'SUBMITTED');
    const finalTxHash = txHash || withdraw.txid || '';

    await this.prisma.withdrawRequest.update({
      where: { id: withdraw.id },
      data: {
        status: finalStatus as any,
        txid: finalTxHash || withdraw.txid,
      },
    });

    const tx = await this.prisma.transaction.findFirst({
      where: {
        kind: 'WITHDRAW_CRYPTO',
        sender_customer_id: withdraw.customer_id,
        asset_in: withdraw.asset,
        amount_in: withdraw.amount.toString(),
        tx_hash: withdraw.txid,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (tx) {
      await this.prisma.transaction.update({
        where: { id: tx.id },
        data: {
          status: finalStatus === 'SUCCESS' ? TransactionStatus.SUCCESS : TransactionStatus.FAILED,
          tx_hash: finalTxHash || tx.tx_hash,
        },
      });
    }

    return { status: 'ok' };
  }
}
