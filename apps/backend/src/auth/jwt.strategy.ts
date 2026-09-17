import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { AuthenticatedUser, PantryRequest } from '../common/request-context';
import { IdentityService } from './identity.service';
import { JWT_ALGORITHM, type AccessTokenClaims } from './session-tokens';

export const JWT_STRATEGY = 'jwt';

/**
 * Passport's part of `AccessGuard`: takes the token from `Authorization: Bearer`,
 * checks its signature against the access token secret and its expiry, and leaves
 * the rest to `IdentityService`. Whatever `validate` returns becomes `request.user`.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_STRATEGY) {
  constructor(
    config: ConfigService,
    private readonly identity: IdentityService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('auth.accessTokenSecret'),
      algorithms: [JWT_ALGORITHM],
      passReqToCallback: true,
    });
  }

  async validate(request: PantryRequest, claims: unknown): Promise<AuthenticatedUser> {
    const user = await this.identity.userFromClaims(claims);
    // `userFromClaims` has checked the claims' shape.
    request.sessionId = (claims as AccessTokenClaims).sid;
    return user;
  }
}
