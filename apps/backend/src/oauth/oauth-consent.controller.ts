import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { OAuthConnections, OAuthConsentRequest, OAuthRedirect } from '@pantry-pal/shared';

import { CurrentUser, type AuthenticatedUser } from '../common/request-context';
import { OAuthConsentService } from './oauth-consent.service';

/**
 * The web app's side of OAuth, as the signed-in user: the consent page reads a
 * pending request and answers it; the profile lists and ends connections. The
 * protocol's own endpoints — metadata, registration, `/authorize`, `/token` —
 * are the MCP SDK's router, mounted at the origin (`mountMcp`).
 */
@Controller()
export class OAuthConsentController {
  constructor(private readonly consent: OAuthConsentService) {}

  @Get('oauth/requests/:id')
  request(@Param('id', ParseUUIDPipe) id: string): Promise<OAuthConsentRequest> {
    return this.consent.request(id);
  }

  @Post('oauth/requests/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OAuthRedirect> {
    return this.consent.approve(id, user.id);
  }

  @Post('oauth/requests/:id/deny')
  @HttpCode(HttpStatus.OK)
  deny(@Param('id', ParseUUIDPipe) id: string): Promise<OAuthRedirect> {
    return this.consent.deny(id);
  }

  @Get('me/connections')
  connections(@CurrentUser() user: AuthenticatedUser): Promise<OAuthConnections> {
    return this.consent.connections(user.id);
  }

  @Delete('me/connections/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  disconnect(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.consent.disconnect(user.id, id);
  }
}
