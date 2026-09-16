# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Scope: `@pantry-pal/backend` — NestJS HTTP + WebSocket API. See the root
`CLAUDE.md` for workspace-wide guidance.

## Commands

```bash
pnpm dev          # nest start --watch
pnpm build        # nest build (tsc builder)
pnpm start        # node dist/main.js
pnpm type-check   # tsc --noEmit
```

Served at `http://localhost:3001/api/v1`; socket namespace `/pantry`.
`GET /api/v1/health` is the liveness route. Set `SEED_DEMO_DATA=true` to boot
with sample items.

## Module format — read before touching tsconfig

**NestJS 12 ships ESM-only.** This package still emits **CommonJS**, which works
only because Node >= 22.12 supports `require()` of ESM.

That is why `tsconfig.json` uses `"module": "nodenext"` with
`"moduleResolution": "nodenext"` — it is what lets `tsc` model that behaviour
_and_ resolve package `exports` subpaths. Plain `"commonjs"` + `"node10"` still
compiles and runs, but cannot resolve `@pantry-pal/shared/dto` and will fail
with a confusing "could not be resolved under your current moduleResolution"
error. The package is deliberately **not** `"type": "module"`.

`emitDecoratorMetadata` and `experimentalDecorators` are required here — Nest
resolves providers from decorator metadata at runtime. `useDefineForClassFields`
must stay `false` for constructor parameter properties to behave.

## Request flow

```
HTTP  → PantryController ┐
                         ├→ PantryService ──→ changes$ (RxJS Subject)
WS    → PantryGateway   ┘                          │
                              PantryGateway ◄──────┘  broadcasts to all clients
```

Both transports write through `PantryService`, which publishes onto `changes$`.
`PantryGateway` holds the single subscription and does all broadcasting.

**Never emit socket events from the service or the controller.** Publish a
change; the gateway fans it out. This is what keeps HTTP and WebSocket writes
consistent and avoids circular DI between gateway and service.

The store is in-memory (a `Map`); there is no database yet.

## Validation and error handling

The global `ValidationPipe` in `main.ts` applies to **every execution context**,
WebSocket handlers included. Consequences:

- Do **not** add a second validation pipe to `@MessageBody()` — the global one
  already ran, and a param-level pipe never gets the chance.
- The global pipe raises `BadRequestException`, which the WebSocket layer
  reports to clients as a bare "Internal server error". `WsExceptionFilter`
  (applied via `@UseFilters` on the gateway) re-wraps HTTP exceptions as
  `WsException` so validation details survive. Keep it on any new gateway.

DTOs come from `@pantry-pal/shared/dto` and must be imported **as values** in
controllers and gateways — Nest reads the runtime class from parameter metadata.

## Socket.IO configuration

Socket.IO does its own CORS handling and **ignores `app.enableCors()`**. Origins
are applied in `PantryIoAdapter`, registered via `app.useWebSocketAdapter()`.
The `@WebSocketGateway()` decorator sets only the namespace, because decorator
options are evaluated at import time — before `ConfigModule` has loaded `.env`.

## Express 5

Nest 12 runs on Express 5, whose `query parser` default changed from `extended`
to `simple`, silently breaking `?tags[]=a&tags[]=b` and `?filter[name]=x`.
`main.ts` restores it with `app.set('query parser', 'extended')` — leave it in.

The app is typed as `NestExpressApplication` so `app.set()` is available.

## Configuration

`config/configuration.ts` is the only place that reads `process.env`; everything
else goes through `ConfigService`. `ConfigModule` loads `.env.local` ahead of
`.env`. See `.env.example` for the supported variables.
