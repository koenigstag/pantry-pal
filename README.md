# Pantry Pal

A Turborepo + pnpm workspace: a NestJS HTTP + WebSocket API and a React/MobX
client, sharing one library of constants, DTOs and utilities.

> **Naming note:** this uses **Turborepo** (the monorepo task runner).
> _Turbopack_ is a different tool — the Rust bundler built into Next.js — and is
> not applicable to a Vite + NestJS workspace.

## Layout

```
pantry-pal/
├── apps/
│   ├── backend/          @pantry-pal/backend   NestJS 12 · REST + Socket.IO
│   └── frontend/         @pantry-pal/frontend  React 19 · MobX 7 · Vite 8
└── packages/
    ├── shared/           @pantry-pal/shared    constants · DTOs · utils · WS contract
    └── db/               @pantry-pal/db        Drizzle + pg · schema · repositories · transactions
```

Dependencies run one way: `db → shared`, `backend → {shared, db}`,
`frontend → shared`. Nothing depends on an app.

`packages/db` owns the PostgreSQL schema, migrations, repositories and the
transaction layer; its design is recorded in `packages/db/CLAUDE.md`. The
backend's API — households, members, locations, items, and an admin API for
units and default locations — is described in `apps/backend/CLAUDE.md`.

`packages/shared` is the point of the workspace. It holds:

- **constants** — API prefix, ports, Socket.IO namespace, event names, and the
  value sets (categories, roles, statuses) the database constraints are
  generated from
- **types** — the wire types (`PantryItem`, `PantryLocation`, `Household`, ...)
  and the socket payload shapes
- **settings** — keys, value types and defaults of the admin-managed settings
- **utils** — expiry maths, formatting, id generation (pure, no dependencies)
- **events** — `ServerToClientEvents` / `ClientToServerEvents`, so a renamed
  socket event or a changed payload is a compile error on _both_ sides
- **DTOs** — `class-validator` request classes, served from a separate subpath

## Prerequisites

Node is pinned in `.nvmrc` (24.21.0 LTS):

```bash
nvm use
```

The version is also declared in every package's `engines` field and **enforced**
by `engineStrict: true` in `pnpm-workspace.yaml` — on a mismatched Node version
`pnpm install` fails with `ERR_PNPM_UNSUPPORTED_ENGINE` rather than warning and
continuing.

pnpm 11 is declared once via `packageManager` at the repo root (not repeated in
sub-packages); `corepack enable` will honour it.

## Getting started

```bash
pnpm install
```

Copy the env templates you need — every package ships a `.env.example`, and
`.env.local` is git-ignored — and fill in the `DATABASE_*` values:

```bash
cp packages/db/.env.example packages/db/.env.local
cp apps/backend/.env.example apps/backend/.env.local
```

Create the schema, and optionally a test household to look at:

```bash
pnpm --filter @pantry-pal/db db:migrate
pnpm --filter @pantry-pal/db db:seed
```

Then run everything:

```bash
pnpm dev
```

Frontend on `http://localhost:3000`, backend on `http://localhost:3001`. Vite
proxies `/api` and `/socket.io` to the backend, so the browser sees one origin
and never hits CORS in development.

## Scripts

| Command                             | What it does                                       |
| ----------------------------------- | -------------------------------------------------- |
| `pnpm dev`                          | Builds `shared`, then runs both apps in watch mode |
| `pnpm build`                        | Topological build: `shared` → apps                 |
| `pnpm type-check`                   | `tsc --noEmit` in every package                    |
| `pnpm lint` / `pnpm lint:fix`       | oxlint                                             |
| `pnpm format` / `pnpm format:check` | oxfmt                                              |
| `pnpm clean`                        | Removes `dist/` and `.turbo/`                      |

## How the build is ordered

Every task in `turbo.json` declares `"dependsOn": ["^build"]`, so Turborepo
builds `@pantry-pal/shared` before anything that depends on it — for `build`,
`dev` and `type-check` alike. This is the Nx-style "libs first" ordering,
enforced by the task graph rather than by convention.

In watch mode `shared` runs `tsup --watch`, so edits to the library flow into
both apps without restarting anything.

## Deployment

Pushing to `main` builds the frontend and publishes it to GitHub Pages
(`.github/workflows/deploy-pages.yml`); the workflow can also be run by hand
from the Actions tab. Once per repository, set **Settings → Pages → Source** to
**GitHub Actions**.

The site is the frontend alone, because Pages cannot run the backend: the shell
and navigation work, and pages that need the API show their load error. It is
served from `https://<owner>.github.io/<repo>/`, a path the workflow passes to
the build as `BASE_PATH`.

## Decisions worth knowing

### Module formats

- **Frontend: ESM.** Vite is ESM-only by design.
- **Backend: CommonJS**, compiled by `tsc` via `nest build` — no bundler, since
  bundling buys a long-lived Node server nothing.
- **`shared`: both.** `tsup` emits ESM _and_ CJS with `exports` conditions,
  which is what lets the two apps disagree about module format without anyone
  having to care.

One caveat that is easy to trip over: **NestJS 12 ships ESM-only.** The backend
still emits CommonJS, which works only because Node >= 22.12 supports `require()`
of ESM. That is why `apps/backend/tsconfig.json` uses `"module": "nodenext"` —
it is what lets `tsc` model that behaviour. Plain `"commonjs"` + `"node10"` also
runs, but cannot resolve `exports` subpaths such as `@pantry-pal/shared/dto`.

### Why DTOs live behind `@pantry-pal/shared/dto`

`class-validator` decorators call `Reflect.getMetadata` **at module-evaluation
time** — and `Reflect.getMetadata` is not JavaScript, it is installed by the
`reflect-metadata` polyfill. Re-exporting the DTOs from the root barrel
therefore made every consumer pay for that, including Vite's own config loader,
which crashed outright.

So the root barrel stays dependency-free and the decorated classes sit behind a
second entry point, which callers **opt into**:

```ts
// types only — erased at compile time, zero runtime cost
import type { CreatePantryItemDto } from '@pantry-pal/shared/dto';

// the classes themselves — pulls in the validation runtime
import { CreatePantryItemDto, validateDto } from '@pantry-pal/shared/dto';
```

`src/dto/index.ts` imports `reflect-metadata` itself, before the decorated
classes are defined. That makes the entry self-contained: no app has to remember
to install the polyfill first, and no import-order mistake can break it.
Correspondingly, `package.json` declares `sideEffects` for the `dist/dto/*`
files — installing a global polyfill genuinely _is_ a side effect, so claiming
`sideEffects: false` there would be lying to the bundler.

### Shared validation on both sides

Both apps validate with the same DTO classes, so a payload the browser accepts
is one the server accepts:

- **backend** — Nest's global `ValidationPipe` reads the classes from decorator
  metadata
- **frontend** — `validateDto(CreatePantryItemDto, payload)` in
  `AddItemForm.tsx`, which mirrors the pipe's options (`whitelist`,
  `forbidNonWhitelisted`) and rejects bad input with no network round-trip

The form sets `noValidate` so the shared DTO is the single source of truth
rather than competing with the browser's own constraint UI.

**Cost:** importing the classes as values adds `class-validator`,
`class-transformer` and `reflect-metadata` to the browser bundle — measured at
**+49.5 KB raw / +13.2 KB gzip** (308.5 → 358.0 KB raw, 97.0 → 110.2 KB gzip).
To drop that, switch the frontend back to `import type` and rely on server
validation alone; nothing else has to change.

One limitation to keep in mind: the shared DTOs are compiled by tsup/esbuild,
which does **not** implement `emitDecoratorMetadata`. Every rule must therefore
be declared explicitly (`@IsInt()`, `@IsIn([...])`, `@Type(() => Number)`) —
never inferred from the TypeScript type. Rules that rely on inferred
`design:type` metadata will silently receive `undefined`.

### Express 5 query parsing

Nest 12 runs on Express 5, which changed the default `query parser` from
`extended` to `simple`. Nested and repeated params (`?tags[]=a&tags[]=b`,
`?filter[name]=x`) silently stop parsing. `apps/backend/src/main.ts` restores
`qs` behaviour with `app.set('query parser', 'extended')`.

### One write path

The backend services publish mutations onto `ChangeFeed`, an RxJS subject;
`PantryGateway` subscribes and broadcasts to the household's room. HTTP and
WebSocket writes therefore both fan out exactly once, and neither transport
depends on the other (no circular DI). A change is published only once its
transaction commits, so a rolled-back write is never announced.

The MobX store deliberately applies **no optimistic update** — an added item
appears only when the server broadcast arrives, so every connected client shows
the same state rather than briefly disagreeing.

### WebSocket error handling

`app.useGlobalPipes()` applies to _every_ execution context, so the global
`ValidationPipe` also validates socket payloads — but it raises
`BadRequestException`, which the WebSocket layer reports to clients as a bare
"Internal server error". `WsExceptionFilter` re-wraps HTTP exceptions so the
validation details survive.

## Planned: typed network layer (not yet implemented)

The shared package removes most drift, but one gap remains. In
`apps/frontend/src/services/api.ts`:

```ts
request<PantryItem[]>(`${household(householdId)}/items`);
```

The path is a hand-written string and the return type is an **unchecked cast**.
Rename a route or change a response shape and the frontend still compiles, then
fails at runtime.

**Chosen direction: OpenAPI + the existing class-validator DTOs.** It builds on
what already works rather than replacing the validation layer.

Steps:

1. Add `@nestjs/swagger` to the backend and build the document in `main.ts`.
2. Generate a typed client into the frontend with `openapi-typescript` (or
   `@hey-api/openapi-ts` / `orval` for a full client).
3. Add the generation as a Turborepo task with `"dependsOn": ["^build"]`, so the
   client is regenerated whenever the backend contract changes.

**Gotcha specific to this layout.** `@nestjs/swagger`'s CLI plugin — the thing
that infers `@ApiProperty()` from TypeScript types and class-validator
decorators, so you don't hand-annotate every field — only runs over files
compiled by the **Nest CLI**. The DTOs here live in `packages/shared` and are
compiled by **tsup**, so the plugin will not see them. Three ways round it:

| Option                                                                                                    | Trade-off                                                                                                                 |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Annotate the shared DTOs with `@ApiProperty()` explicitly                                                 | Adds `@nestjs/swagger` as a dependency of `shared`; heavy, though the `/dto` split keeps it out of the browser at runtime |
| Use `class-validator-jsonschema` in the backend to derive schemas from the decorators already present     | Keeps `shared` free of Nest dependencies — **recommended**                                                                |
| Thin backend DTO subclasses that extend the shared ones and add `@ApiProperty()`, with the plugin enabled | Explicit and plugin-friendly, but duplicates the field list                                                               |

For reference, had the DTOs been Zod instead, wiring them into Nest would have
been straightforward (`nestjs-zod`'s `createZodDto` + `ZodValidationPipe`), and
it would have let `/dto` collapse back into the main barrel. That door stays
open.

## Tooling

- **oxlint** (`.oxlintrc.json`) — linting. Two rules are switched off, with
  reasons recorded in the config: `import/no-unassigned-import` (side-effect
  imports such as `reflect-metadata` and `./index.css` are intentional) and, for
  the backend, `promise/valid-params` (it misreads NestJS's
  `ExceptionFilter.catch` as `Promise.catch`).
- **oxfmt** (`.oxfmtrc.json`) — formatting, with import sorting enabled.
