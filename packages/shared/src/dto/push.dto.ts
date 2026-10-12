import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateBy,
  ValidateNested,
} from 'class-validator';

import { MAX_PUSH_ENDPOINT_LENGTH, PUSH_SERVICE_HOSTS, PUSH_TOPICS } from '../constants';
import type { PushTopic } from '../constants';

/** Whether `endpoint` is an https URL at one of `PUSH_SERVICE_HOSTS`, on its default port. */
function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    return false;
  }
  return PUSH_SERVICE_HOSTS.some((host) =>
    host.startsWith('.') ? url.hostname.endsWith(host) : url.hostname === host,
  );
}

function IsPushServiceEndpoint(): PropertyDecorator {
  return ValidateBy({
    name: 'isPushServiceEndpoint',
    validator: {
      validate: (value: unknown) => typeof value === 'string' && isPushServiceEndpoint(value),
      defaultMessage: (args) =>
        `${args?.property ?? 'endpoint'} must be an https URL of a known push service`,
    },
  });
}

/** Base64url, as `PushSubscription.toJSON()` writes keys; padding is tolerated. */
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** The browser's keys for this subscription, which the server encrypts each push to. */
export class PushSubscriptionKeysDto {
  /** The browser's P-256 public key: 65 bytes, 87 characters unpadded. */
  @IsString()
  @Length(80, 100)
  @Matches(BASE64URL)
  p256dh!: string;

  /** The shared authentication secret: 16 bytes, 22 characters unpadded. */
  @IsString()
  @Length(16, 32)
  @Matches(BASE64URL)
  auth!: string;
}

/**
 * `PUT /push/devices`: this browser, as `PushSubscription.toJSON()` describes
 * it, and what it wants to hear about. Registers it, or replaces the topics of
 * a browser registered already: a browser has one endpoint per profile, so the
 * endpoint is the device.
 */
export class RegisterPushDeviceDto {
  @IsString()
  @MaxLength(MAX_PUSH_ENDPOINT_LENGTH)
  @IsPushServiceEndpoint()
  endpoint!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;

  /** May be empty: registered, but quiet until a topic is switched on. Repeats are stored once. */
  @IsArray()
  @ArrayMaxSize(PUSH_TOPICS.length * 2)
  @IsIn([...PUSH_TOPICS], { each: true })
  topics!: PushTopic[];
}
