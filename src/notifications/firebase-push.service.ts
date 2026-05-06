import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, PushPlatform } from '@prisma/client';
import * as admin from 'firebase-admin';

export interface PushContent {
  title: string;
  text: string;
  url?: string;
}

@Injectable()
export class FirebasePushService {
  private readonly logger = new Logger(FirebasePushService.name);
  private initialized = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaClient,
  ) {}

  private ensureInitialized(): boolean {
    if (this.initialized) return true;

    try {
      if (!admin.apps.length) {
        const rawJson = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');

        if (rawJson && rawJson.trim()) {
          const serviceAccount = JSON.parse(rawJson);
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
          });
        } else {
          admin.initializeApp({
            credential: admin.credential.applicationDefault(),
          });
        }
      }

      this.initialized = true;
      return true;
    } catch (error) {
      const details = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`Firebase init failed: ${details}`);
      return false;
    }
  }

  private buildDataPayload(content: PushContent): Record<string, string> {
    const payload: Record<string, string> = {
      id: 'showNotification',
      title: content.title,
      text: content.text,
    };

    if (content.url) payload.url = content.url;
    return payload;
  }

  private isInvalidTokenErrorCode(code?: string): boolean {
    return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token';
  }

  private async deactivateToken(token: string, reason: string): Promise<void> {
    await this.prisma.userPushToken.updateMany({
      where: { token },
      data: {
        is_active: false,
        last_error: reason,
      },
    });
  }

  async sendToToken(token: string, content: PushContent): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    if (!this.ensureInitialized()) {
      return { ok: false, error: 'firebase_not_initialized' };
    }

    try {
      const messageId = await admin.messaging().send({
        token,
        data: this.buildDataPayload(content),
        android: {
          priority: 'high',
        },
      });
      return { ok: true, messageId };
    } catch (error) {
      const err = error as any;
      const code = typeof err?.code === 'string' ? err.code : undefined;
      const details = err?.message || 'unknown';

      if (this.isInvalidTokenErrorCode(code)) {
        await this.deactivateToken(token, `${code}: ${details}`);
      }

      return { ok: false, error: `${code || 'firebase_error'}: ${details}` };
    }
  }

  async sendToCustomer(
    customerId: number,
    content: PushContent,
    platform: PushPlatform = PushPlatform.ANDROID,
  ): Promise<{ sent: number; failed: number; skipped: boolean; details: string[] }> {
    const customer = await this.prisma.customer.findUnique({
      where: { customer_id: customerId },
      select: { push_enabled: true },
    });

    if (!customer || !customer.push_enabled) {
      return { sent: 0, failed: 0, skipped: true, details: ['push_disabled'] };
    }

    const tokens = await this.prisma.userPushToken.findMany({
      where: {
        customer_id: customerId,
        is_active: true,
        platform,
      },
      select: { token: true },
    });

    if (!tokens.length) {
      return { sent: 0, failed: 0, skipped: false, details: ['no_active_tokens'] };
    }

    let sent = 0;
    let failed = 0;
    const details: string[] = [];

    for (const row of tokens) {
      const result = await this.sendToToken(row.token, content);
      if (result.ok) {
        sent += 1;
        details.push(`ok:${row.token.slice(0, 12)}`);
      } else {
        failed += 1;
        details.push(`fail:${row.token.slice(0, 12)}:${result.error}`);
      }
    }

    return { sent, failed, skipped: false, details };
  }

  async sendBroadcastToActiveAndroid(
    content: PushContent,
  ): Promise<{ sent: number; failed: number; skipped: boolean; details: string[] }> {
    const activeTokens = await this.prisma.userPushToken.findMany({
      where: {
        is_active: true,
        platform: PushPlatform.ANDROID,
        customer: {
          push_enabled: true,
        },
      },
      select: { token: true },
    });

    if (!activeTokens.length) {
      return { sent: 0, failed: 0, skipped: true, details: ['no_active_tokens'] };
    }

    let sent = 0;
    let failed = 0;
    const details: string[] = [];

    const chunkSize = 100;
    for (let i = 0; i < activeTokens.length; i += chunkSize) {
      const chunk = activeTokens.slice(i, i + chunkSize);
      const results = await Promise.all(chunk.map((row) => this.sendToToken(row.token, content)));

      for (let j = 0; j < chunk.length; j += 1) {
        const token = chunk[j].token;
        const result = results[j];

        if (result.ok) {
          sent += 1;
          if (details.length < 200) details.push(`ok:${token.slice(0, 12)}`);
        } else {
          failed += 1;
          if (details.length < 200) details.push(`fail:${token.slice(0, 12)}:${result.error}`);
        }
      }
    }

    return { sent, failed, skipped: false, details };
  }
}
