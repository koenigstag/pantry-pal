/**
 * Who this browser claims to be. A development stand-in for signing in: the
 * backend trusts it only with `DEV_AUTH=true` (see `DEV_USER_HEADER` in
 * `@pantry-pal/shared`), and real authentication will replace this module.
 *
 * The fallback is the owner of the test household that `pnpm db:seed` creates,
 * so a freshly seeded database opens straight onto realistic data. Set
 * `VITE_DEV_USER_EMAIL` to act as someone else — an unknown email becomes a new
 * user with an empty household.
 */
export const devUserEmail: string = import.meta.env.VITE_DEV_USER_EMAIL ?? 'owner@pantry-pal.test';
