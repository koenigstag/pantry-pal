import { Injectable } from '@nestjs/common';
import { Algorithm, hash, verify, type Options } from '@node-rs/argon2';

/**
 * OWASP's baseline for Argon2id: 19 MiB of memory, two passes, one thread.
 * Every hash records its parameters, so raising them later leaves existing
 * passwords verifiable.
 */
const ARGON2_OPTIONS: Options = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/** Hashing runs on libuv's thread pool, off the event loop. */
@Injectable()
export class PasswordHasher {
  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password);
  }
}
