import { SetMetadata } from '@nestjs/common';

export const ACCESS_METADATA = 'pantry-pal:access';

/** How a route authenticates. Anything unmarked requires a user. */
export const ACCESS = {
  User: 'user',
  Public: 'public',
  Admin: 'admin',
} as const;
export type Access = (typeof ACCESS)[keyof typeof ACCESS];

/** No identity required: liveness, reference data. */
export const Public = () => SetMetadata(ACCESS_METADATA, ACCESS.Public);

/** Authenticated by the admin API key instead of a user identity. */
export const AdminOnly = () => SetMetadata(ACCESS_METADATA, ACCESS.Admin);
