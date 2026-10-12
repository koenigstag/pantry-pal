import type { PantryRequest } from '../common/request-context';

const MINUTE = 60_000;

/**
 * `@Throttle` options for routes that check a password on the way in: sign-up,
 * sign-in and dev sign-in. Per client address, since the caller is not known yet.
 */
export const CREDENTIAL_ATTEMPTS = { default: { limit: 10, ttl: MINUTE } };

/**
 * `@Throttle` options for changing a password, per account rather than per
 * address: guessing the current password with a copied access token gains
 * nothing from spreading requests over many addresses. `AccessGuard`, a global
 * guard, has set `request.user` by the time the throttler runs.
 */
export const PASSWORD_CHANGE_ATTEMPTS = {
  default: {
    limit: 5,
    ttl: MINUTE,
    getTracker: (request: object): string => {
      const { user, ip } = request as PantryRequest;
      return user === undefined ? `address:${ip ?? 'unknown'}` : `user:${user.id}`;
    },
  },
};

/**
 * `@Throttle` options for the text assistant's interpreting, per account: each
 * request costs a call to the model. Generous for someone dictating a shelf
 * line by line, and a ceiling on what a copied access token can spend.
 */
export const ASSISTANT_REQUESTS = {
  default: {
    limit: 10,
    ttl: MINUTE,
    getTracker: (request: object): string => {
      const { user, ip } = request as PantryRequest;
      return user === undefined ? `address:${ip ?? 'unknown'}` : `assistant:${user.id}`;
    },
  },
};

/**
 * `@Throttle` options for a test notification, per account: each one is a request
 * to a push service on the server's name. Enough for trying it out a few times.
 */
export const PUSH_TEST_REQUESTS = {
  default: {
    limit: 5,
    ttl: MINUTE,
    getTracker: (request: object): string => {
      const { user, ip } = request as PantryRequest;
      return user === undefined ? `address:${ip ?? 'unknown'}` : `push-test:${user.id}`;
    },
  },
};
