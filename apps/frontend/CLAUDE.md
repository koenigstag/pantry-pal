# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Scope: `@pantry-pal/frontend` — React + MobX client. See the root `CLAUDE.md`
for workspace-wide guidance.

## Commands

```bash
pnpm dev          # vite (port 3000, strictPort)
pnpm build        # vite build — does NOT type-check
pnpm preview      # serve the production build
pnpm type-check   # tsc --noEmit
```

`vite build` only bundles. Type errors surface in `pnpm type-check`, which
Turborepo runs as its own task — check both before assuming a change is clean.

`strictPort` is on deliberately: silently moving to another port would fall
outside the backend's CORS allowlist and produce confusing socket failures.

## MobX conventions

- **No decorators.** Stores use `makeAutoObservable(this, ..., { autoBind: true })`.
  Vite transpiles with esbuild, which does not implement
  `emitDecoratorMetadata`, so `@observable`-style code is off the table.
- Collaborators (`api`, `socket`) are excluded from observability via the
  overrides argument and the `makeAutoObservable<Store, 'api' | 'socket'>`
  generic — private fields are not in `keyof this`, so the generic is required.
- `main.tsx` sets `enforceActions: 'always'`. Every mutation must happen inside
  an action; `await` continuations therefore need `runInAction`.
- Components are wrapped in `observer` from `mobx-react-lite`. A component that
  reads store state without it will not re-render.

## State flow

`PantryStore` **applies no optimistic updates**. Writes send a request and wait
for the resulting server broadcast to mutate state. This keeps every connected
client in agreement — preserve it unless deliberately changing the model.

Reads arrive two ways: a REST fetch on mount (so the list populates even if the
socket never connects) and a snapshot requested on socket connect.

The store shows **one household**: the user's first, or a new "Home" created
for a user with none. The socket delivers events for every household the user
belongs to, so each handler ignores payloads for any other household. Items
that stop being active (consumed, discarded) leave the list.

**Identity is a development stand-in.** `services/identity.ts` sends
`VITE_DEV_USER_EMAIL` (default: the seeded test household's owner) as the
`x-dev-user-email` header and in the socket handshake `auth`. Real sign-in
replaces that one module.

`StoreProvider` constructs the root store in a `useState` lazy initialiser
because `new RootStore()` opens a socket — it must not run on every render.
StrictMode's double-mount in development causes one connect/disconnect/connect
cycle; the resulting console warning is expected.

## Importing from shared

```ts
// zero runtime cost — erased at compile time
import type { CreatePantryItemDto } from '@pantry-pal/shared/dto';

// pulls class-validator + class-transformer + reflect-metadata into the bundle
import { CreatePantryItemDto, validateDto } from '@pantry-pal/shared/dto';
```

`AddItemForm` uses the **value** import so the browser validates with the same
DTO class the server enforces, rejecting bad input with no network round-trip.
That costs ~+13 KB gzip. Reverting to `import type` drops the cost and defers
validation to the server; nothing else needs to change.

The form sets `noValidate` so the shared DTO is the sole source of validation
truth rather than competing with the browser's own constraint UI.

This package does **not** need `experimentalDecorators` — it never defines a
decorated class, it consumes ones tsup already compiled.

## Dev server proxying

`vite.config.ts` proxies `/api` and `/socket.io` to the backend, so the browser
sees a single origin and never hits CORS in development. It imports path
constants from `@pantry-pal/shared` to guarantee the proxy paths and the
client's request paths agree — which is why the shared package must be built
before Vite starts.

Only `VITE_`-prefixed variables reach browser code; unprefixed ones
(`PORT`, `BACKEND_PORT`) are read by the config at startup and stay server-side.
