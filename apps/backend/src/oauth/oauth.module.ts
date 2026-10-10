import { Module } from '@nestjs/common';

import { OAuthConsentController } from './oauth-consent.controller';
import { OAuthConsentService } from './oauth-consent.service';
import { PantryOAuthProvider } from './oauth-provider';

/** The authorization server's storage and the user's side of it; `mountMcp` mounts the protocol. */
@Module({
  controllers: [OAuthConsentController],
  providers: [PantryOAuthProvider, OAuthConsentService],
  exports: [PantryOAuthProvider],
})
export class OAuthModule {}
