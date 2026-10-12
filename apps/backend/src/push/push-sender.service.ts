import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PushTarget } from '@pantry-pal/db';
import type { PushPayload } from '@pantry-pal/shared';
import { sendNotification, WebPushError } from 'web-push';

import type { VapidDetails } from '../config/configuration';

/**
 * How long a push service holds a notification for a device that is off or out
 * of signal: half a day. By the evening, "last day today" is about yesterday.
 */
const TTL_SECONDS = 12 * 60 * 60;

/**
 * - `sent`: the push service took it, which says nothing about it being shown.
 * - `gone`: the service says the device is no longer there, so its row goes.
 * - `failed`: it may work next time, so the row stays; nothing is retried.
 */
export type PushDelivery = 'sent' | 'gone' | 'failed';

/**
 * The one place that talks to push services — Google's, Mozilla's, Apple's,
 * Microsoft's — over Web Push, with the VAPID pair from the configuration.
 *
 * Without the pair, push is off: `publicKey` is null, which the app reads as
 * "hide the switches", and nothing is ever sent. Sending is best-effort and
 * never throws: a notification is the pantry's echo, never part of a write.
 */
@Injectable()
export class PushSender {
  private readonly logger = new Logger(PushSender.name);
  private readonly vapid: VapidDetails | undefined;

  constructor(config: ConfigService) {
    this.vapid = config.get<VapidDetails>('push.vapid');
  }

  get isEnabled(): boolean {
    return this.vapid !== undefined;
  }

  /** What a browser subscribes with; null while push is off. */
  get publicKey(): string | null {
    return this.vapid?.publicKey ?? null;
  }

  /** Encrypts one payload to one device's keys and hands it to its push service. */
  async send(target: PushTarget, payload: PushPayload): Promise<PushDelivery> {
    if (this.vapid === undefined) return 'failed';

    try {
      await sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { vapidDetails: this.vapid, TTL: TTL_SECONDS, urgency: 'normal' },
      );
      return 'sent';
    } catch (error) {
      // 404 and 410 are the service saying the subscription is over: the
      // permission revoked, the site's data cleared, the browser gone.
      if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
        return 'gone';
      }
      const reason =
        error instanceof WebPushError ? `${error.statusCode} ${error.body}` : String(error);
      // The service's host, never the endpoint: whoever holds that URL can send to the device.
      this.logger.warn(`Push to ${hostOf(target.endpoint)} failed: ${reason}`);
      return 'failed';
    }
  }
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'an unreadable endpoint';
  }
}
