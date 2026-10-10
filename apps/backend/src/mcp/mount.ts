import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { MCP_PATH, MCP_SCOPE } from '@pantry-pal/shared';
import express, { type Request, type Response } from 'express';

import { PantryOAuthProvider } from '../oauth/oauth-provider';
import { McpToolsService } from './mcp-tools.service';

/** The largest JSON-RPC request taken: a long set of changes is a few kilobytes. */
const MAX_REQUEST_BYTES = '256kb';

/**
 * Mounts the MCP endpoint and the OAuth authorization server at the origin,
 * outside Nest's routing and the `/api/v1` prefix: the protocols fix their own
 * paths (`/.well-known/...`, `/authorize`, `/token`, `/register`, `/revoke`),
 * and neither the global `AccessGuard` nor the JSON body parser may stand in
 * front of them. Must run before `app.listen()`, so these come before Nest's
 * own middleware.
 *
 * The endpoint is stateless Streamable HTTP: each POST gets a fresh server and
 * transport and answers with JSON, so nothing is held between requests and any
 * instance can serve any request. GET (a server-sent event stream) and DELETE
 * (ending a session) have nothing to do without sessions and answer 405.
 */
export function mountMcp(app: INestApplication): void {
  const provider = app.get(PantryOAuthProvider);
  const tools = app.get(McpToolsService);
  const logger = new Logger('Mcp');
  const resourceUrl = provider.resourceUrl;
  const issuerUrl = new URL(resourceUrl.origin);

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl,
      resourceServerUrl: resourceUrl,
      resourceName: 'Pantry Pal',
      scopesSupported: [MCP_SCOPE],
      // Connectors keep their registration for good; an expiring secret would cut them off.
      clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
    }),
  );

  const bearer = requireBearerAuth({
    verifier: provider,
    requiredScopes: [MCP_SCOPE],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
    expectedResource: resourceUrl,
  });

  app.use(MCP_PATH, (req: Request, res: Response, next: () => void) => {
    if (req.method === 'POST') {
      next();
      return;
    }
    res
      .status(405)
      .set('Allow', 'POST')
      .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  });

  // Wrapped, never mounted as is: Nest skips its own JSON parser when it finds a
  // layer named `jsonParser` anywhere in the stack, and this one would be it.
  const parseJson = express.json({ limit: MAX_REQUEST_BYTES });
  const mcpJsonBody = (req: Request, res: Response, next: (error?: unknown) => void): void =>
    parseJson(req, res, next);

  app.use(MCP_PATH, bearer, mcpJsonBody, (req: Request, res: Response) => {
    void (async () => {
      const server = tools.createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        logger.error(`MCP request failed: ${String(error)}`);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      }
    })();
  });
}
