import { Module } from '@nestjs/common';

import { ChangesModule } from '../changes/changes.module';
import { HouseholdsModule } from '../households/households.module';
import { OAuthModule } from '../oauth/oauth.module';
import { McpToolsService } from './mcp-tools.service';

/** The MCP server's tools; `mountMcp` serves them, behind `OAuthModule`'s tokens. */
@Module({
  imports: [OAuthModule, HouseholdsModule, ChangesModule],
  providers: [McpToolsService],
})
export class McpModule {}
