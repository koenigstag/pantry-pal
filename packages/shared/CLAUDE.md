# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Scope: `@pantry-pal/shared` — the library both apps depend on. See the root
`CLAUDE.md` for workspace-wide guidance.

## Commands

```bash
pnpm build        # tsup: ESM + CJS + declarations
pnpm dev          # tsup --watch
pnpm type-check   # tsc --noEmit
```

This package must be built before either app can build, type-check or start.

## Two entry points, and why

| Subpath                  | Contents                                          | Runtime deps                                         |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------- |
| `@pantry-pal/shared`     | constants, types, utils, WebSocket contract       | **none**                                             |
| `@pantry-pal/shared/dto` | `class-validator` request classes + `validateDto` | class-validator, class-transformer, reflect-metadata |

**The root barrel must stay dependency-free.** It is imported by
`apps/frontend/vite.config.ts`, which Node evaluates at config-load time where
no bundler tree-shaking exists. Adding `export * from './dto'` to
`src/index.ts` will crash the frontend build with
`Reflect.getMetadata is not a function`.

`src/dto/index.ts` imports `reflect-metadata` as its first statement so the
polyfill is installed before the decorated classes are defined. That makes the
entry self-contained — no consumer has to remember an import order. Keep it
first.

Because of that polyfill, `package.json` lists `sideEffects` for the
`dist/dto/*` files. Do not change it back to `sideEffects: false` — installing a
global polyfill genuinely is a side effect, and the claim would let a bundler
drop it.

## Writing DTOs

esbuild does not implement `emitDecoratorMetadata`, so **state every rule
explicitly**:

```ts
@Type(() => Number)   // required — the design-time type is not emitted
@IsInt()
@Min(1)
quantity!: number;
```

A decorator that infers its constraint from the TypeScript type will receive
`undefined` and silently validate nothing. `validateDto()` mirrors the backend
`ValidationPipe`'s options (`whitelist`, `forbidNonWhitelisted`) so both sides
accept exactly the same payloads — change one and change the other.

## The WebSocket contract

`src/events.ts` declares `ServerToClientEvents` / `ClientToServerEvents` using
computed keys from the `PANTRY_EVENT` / `PANTRY_COMMAND` const objects. Both the
gateway and the socket client are typed with these, so a renamed event or a
changed payload is a compile error on both ends rather than a silent no-op.

Add new events by extending the const object _and_ the interface together.

## Conventions

- `src/utils/` is pure and dependency-free, and runs in both Node and the
  browser. Keep it that way — anything needing a runtime dependency belongs in
  a separate entry point.
- Wire types use ISO-8601 **strings** for dates, never `Date`.
- Value sets (`PANTRY_UNITS`, `PANTRY_CATEGORIES`) are `as const` arrays with
  types derived via `(typeof X)[number]`, so the runtime list used by
  `@IsIn([...X])` and the compile-time union can never disagree.
