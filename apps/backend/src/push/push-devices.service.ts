import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PushDevicesRepository, type PushDeviceRow } from '@pantry-pal/db';
import type { PushDevice, PushStatus, PushTestResult } from '@pantry-pal/shared';
import type { RegisterPushDeviceDto } from '@pantry-pal/shared/dto';

import type { AuthenticatedUser } from '../common/request-context';
import { pushMessages } from './push-messages';
import { PushSender } from './push-sender.service';

function toPushDevice(row: PushDeviceRow): PushDevice {
  return {
    id: row.id,
    endpoint: row.endpoint,
    topics: row.topics,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The caller's own devices: registering this browser, its switches, and a test. */
@Injectable()
export class PushDevicesService {
  constructor(
    private readonly devices: PushDevicesRepository,
    private readonly sender: PushSender,
  ) {}

  status(): PushStatus {
    return { publicKey: this.sender.publicKey };
  }

  async list(user: AuthenticatedUser): Promise<PushDevice[]> {
    return (await this.devices.listForUser(user.id)).map(toPushDevice);
  }

  /**
   * Registers this browser under the caller's session, or changes its topics.
   * The session is what signing out ends, and the device with it.
   */
  async register(
    user: AuthenticatedUser,
    sessionId: string | undefined,
    dto: RegisterPushDeviceDto,
  ): Promise<PushDevice> {
    this.assertEnabled();
    const session = this.assertSession(sessionId);

    const row = await this.devices.register({
      userId: user.id,
      sessionId: session,
      endpoint: dto.endpoint,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      topics: [...new Set(dto.topics)],
    });
    return toPushDevice(row);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    if ((await this.devices.deleteForUser(user.id, id)) === undefined) {
      throw new NotFoundException('Device not found');
    }
  }

  /**
   * Sends a test to this session's devices, whatever topics they have on: it
   * answers "do notifications reach me here at all".
   */
  async test(user: AuthenticatedUser, sessionId: string | undefined): Promise<PushTestResult> {
    this.assertEnabled();
    const targets = await this.devices.targetsForSession(this.assertSession(sessionId));
    if (targets.length === 0) {
      throw new NotFoundException('This device is not registered for notifications');
    }

    const { test } = pushMessages(user.locale);
    const deliveries = await Promise.all(
      targets.map(async (target) => {
        const delivery = await this.sender.send(target, { ...test, path: '', tag: 'test' });
        if (delivery === 'gone') await this.devices.delete(target.id);
        return delivery;
      }),
    );
    return { sent: deliveries.filter((delivery) => delivery === 'sent').length };
  }

  private assertEnabled(): void {
    if (!this.sender.isEnabled) {
      throw new NotFoundException('Push notifications are turned off on this server');
    }
  }

  /** A device belongs to a session; the development header has none. */
  private assertSession(sessionId: string | undefined): string {
    if (sessionId === undefined) {
      throw new ForbiddenException('Notifications need a signed-in session');
    }
    return sessionId;
  }
}
