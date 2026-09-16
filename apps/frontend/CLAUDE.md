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

`strictPort` is on, so a taken port fails loudly instead of Vite moving on by
itself. Another port works when chosen on purpose: `PORT` sets it, which is how
the preview in `.claude/launch.json` gets one (`autoPort`). The backend's CORS
allowlist does not need to list it, because the browser only ever talks to Vite:
REST and the socket go through the proxy, and the socket uses the `websocket`
transport, whose upgrade Socket.IO does not check against its `cors` origins.

## Layout

```
src/main.tsx, router.tsx   entry; React Router data router
src/features/shell/        AppShell (sidebar from md up, bottom tab bar below), PageStatus
src/features/storage/      the Storage page: location tabs, search, sort, selection, cards, sheets
src/features/pages.tsx     Shopping and Planner placeholders, Profile
src/stores/                PantryStore (server state), QuantityUpdates (overlay), NoticeStore
src/services/              api (REST), socket, identity (development sign-in)
src/ui/                    primitives: Dialog, Menu, IconButton, SheetButton, cn
src/i18n/                  message catalog and Intl formatters
```

## Routing — React Router 8

- Data mode: `createBrowserRouter` in `router.tsx`, and `RouterProvider` from
  **`react-router/dom`**. v8 removed the `react-router-dom` package; everything
  else imports from `react-router`.
- Routes carry components only. Data comes from the MobX stores, not loaders.
- Storage URL state is `/storage/:locationId?sort=expiry&dir=desc`
  (`useStorageParams`). The location is a path segment, so each tab is a link
  and the back button walks through them. The sort is a query parameter changed
  with `replace`, and defaults stay out of the URL.
- An item's details are a child route, `/storage/:locationId/items/:itemId`,
  rendered by `ItemDetailsDialog` into `StoragePage`'s `<Outlet>` over the list.
  The back button closes them. The card's link carries `OPENED_FROM_LIST` state,
  so closing pops that history entry; a details URL opened directly closes with
  `replace` instead. While the edit form has unsaved changes, `useBlocker` holds
  every way out (Escape, backdrop, Back, the browser back button) behind a
  discard confirmation.
- The edit form (`ItemEditForm`) reuses the details view's layout and sections
  (`detailsLayout.tsx`), so switching modes keeps everything in place. Save is
  enabled only once something changed, and sends only the changed fields.
  If another member saves the item while the form is open, `rebaseDraft` moves
  every untouched field onto their values and names any field both changed.
  Switching modes moves focus to the first field (fine pointer) or the dialog
  title (touch, where a focused field would pop the keyboard up); a failed save
  focuses the first invalid field.
- Field errors come from the catalog (`itemFieldErrors`), one message per field
  saying what it accepts, rather than class-validator's English. Rules a DTO
  cannot state (size value and unit together, no future opened date) live in
  `ruleErrors`.

## MobX conventions

- **No decorators.** Stores use `makeAutoObservable(this, ..., { autoBind: true })`.
  Vite transpiles with esbuild, which does not implement
  `emitDecoratorMetadata`, so `@observable`-style code is off the table.
- **MobX 7 annotations are named exports**: `observableRef`,
  `observableShallow`, `computedStruct`, `actionBound`. `observable.ref` and
  its siblings were removed and fail the type-check.
- Collaborators (`api`, `socket`) and non-observable bookkeeping are excluded via
  the overrides argument and the `makeAutoObservable<Store, 'api' | ...>`
  generic — private fields are not in `keyof this`, so the generic is required.
- `main.tsx` sets `enforceActions: 'always'`. Every mutation must happen inside
  an action; after an `await`, call an action method or use `runInAction`.
- Components are wrapped in `observer` from `mobx-react-lite`. A component that
  reads store state without it will not re-render.
- Wire data sits in `observableRef` fields and is replaced, never mutated.
  `reconcileById` keeps the object of every unchanged entity, so memoised cards
  skip re-rendering. That only pays off if the callbacks passed to cards are
  stable (`useCallback`).

## State flow

`PantryStore` holds **server state only** and is never written optimistically.
A write waits for the server and applies its response; the matching broadcast
then re-applies the same data. `acceptItem` never regresses an item to an older
`updatedAt`.

Quantities are whole numbers (`@IsInt()` in the shared DTOs, `integer` in the
database), counted in a count unit — `pcs` or a container such as `bottle` or
`bag`; an amount is a size of any kind, `1 bag × 1.5 kg`. So the quantity unit
picker offers count units only, while the size picker groups every kind. Count
units read as plural nouns from the catalog (`messages.units.countNoun`: `2
cans`), and a code the catalog lacks, such as one an admin added, shows its API
label. `pcs` alone is left out beside a size: `2 × 150 g`.

**The one exception is stepping a quantity.** `QuantityUpdates` keeps an overlay
of unconfirmed quantities, and cards render `quantityOf(item)`, so a tap shows at
once. The PATCH goes out 600 ms after the last tap on that item, one request per
item, always with the newest value. Once the server confirms, the overlay is
dropped and items are refetched in the background; a failure drops the overlay
and shows a notice. Sorting by quantity reads the server value, so a card does
not move while it is being tapped. Keep any new optimism out of `PantryStore`.

Background refetches (`refreshItems`) never show a loading state or clear the
list. A broadcast that lands while a refetch is in flight wins over the
response, and a snapshot supersedes it entirely.

Reads arrive two ways: a REST fetch on mount (so the page populates even if the
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
cycle and doubled bootstrap requests; the resulting console warning is expected.

### The locations editor

Users know locations as **storage spaces**: the message catalog says so
everywhere, while code, routes, the API and the database keep `location`.

`LocationEditorDialog` opens from the `+` beside the tabs and from Edit storage
spaces in the ⋮ menu, showing the saved locations only; its Add storage space
button appends an empty row, which is ignored on save until named. It
renames, adds, deletes and reorders, then saves everything with **one**
`PUT .../locations` (`PantryStore.saveLocations`); other clients receive one
`LocationsUpserted` list, never the intermediate steps. Deleting a location that
holds items asks where they go (`moveItemsTo`), preselecting the fallback
location, and the server moves them in the same transaction.

Every household has one **fallback location**, "Other" (`isFallback`): the
server moves a deleted location's items there when told nothing else, and
refuses to rename or delete it. In the editor it can still be reordered, but its
name is a read-only input, a lock stands where its delete button would be, and a
hint under the row says why. Because it always stays, a household always keeps
at least one location, and the editor needs no rule of its own for that.

The draft lives in the component, not the store, and is **rebased onto
`pantry.locations` on every render** (`locationDraft.ts`): locations other
members add or delete meanwhile appear or drop out, and an untouched name
follows a rename made elsewhere. The server answers 409 when the list the user
edited was stale; the store then refetches, the draft rebases, and the user
checks the list and saves again.

## Styling — Tailwind CSS 4

- Wired through `@tailwindcss/vite`; the theme lives in `src/index.css`.
- **The default palette is cleared** (`--color-*: initial`). Use the semantic
  tokens only: `canvas`, `surface`, `sunken`, `line`, `ink`, `ink-muted`,
  `accent`, `accent-hover`, `accent-soft`, `on-accent`, `danger`, `danger-soft`,
  `warn`, `warn-soft`, `success`, `scrim`. Dark mode redefines the tokens under
  `prefers-color-scheme`, so colours need no `dark:` variants.
- Logical utilities only (`ms-`, `pe-`, `start-`, `border-e`, `text-start`), so
  the layout mirrors for right-to-left languages.
- The item grid sizes its columns with container queries (`@container`, `@lg:`),
  not viewport breakpoints: three a row on a phone, at most seven.
- Custom utilities: `focus-ring` (a focus-visible outline in `currentColor`,
  which stays visible on the accent header) and `scrollbar-none`.

## UI primitives — native elements, no component library

- `ui/Dialog` is a native `<dialog>` opened with `showModal()`, which supplies
  the focus trap, the inert page, Escape and the top layer. **On a phone a
  dialog is either a sheet or fills the screen.** `variant="sheet"` rises from
  the bottom on narrow screens; `fullscreen` fills a phone and is a large panel
  on wide screens, with a header bar on both. The default `modal` fills a phone
  with a header bar — close button, title, and the primary action passed as
  `headerEnd` — and is a centred box from `md` up, where the bar folds into a
  plain heading. A modal form therefore shows its own Cancel/Save row only from
  `md` up (`hidden md:flex`), and the header action submits it through
  `form={formId}`. Keep a dialog mounted and toggle `open`, so focus can return
  to the opener.
- **A dialog never closes itself.** Escape (its `cancel` event is prevented), the
  backdrop and the close button only call `onClose`; the owner closes it by
  setting `open` to false or unmounting it, and may decline — a blocked
  navigation leaves it open. Two traps its event handlers guard against:
  - React bubbles `cancel` and `close` through the component tree although the
    browser does not, so a dialog nested inside another (a confirmation sheet)
    would be taken for the outer one closing. Handlers ignore events whose
    `target` is not their own dialog.
  - `close` is dispatched as a task. StrictMode's development remount closes and
    reopens a freshly mounted dialog, and the stale `close` lands after the
    reopen: a handler that trusted it closed the item details the instant they
    opened. A `close` event on a dialog that is open again is ignored.
- Modal dialogs cover the page's `NoticeRegion` and make it inert: show an error
  from a dialog inside the dialog, as `AddItemDialog` does, and render a
  `NoticeRegion placement="dialog"` inside a full-screen one whose actions
  (the quantity stepper) raise notices.
- Form fields use `ui/Field`, which ties the label, an optional hint and the
  error to the control (`aria-describedby`, `aria-invalid`) through a render prop.
- `ui/Menu` uses the Popover API (`popover="auto"` plus `popoverTarget`) and adds
  placement, arrow-key navigation, and closing on Tab, scroll or resize.
- An action that is not available yet uses `aria-disabled`, not `disabled`, so it
  stays focusable and can explain itself through a notice or a hint.
- **Drag-and-drop is the one library exception:** `@dnd-kit/core` +
  `@dnd-kit/sortable` (the stable line, not the pre-1.0 `@dnd-kit/react`), for
  pointer, touch and keyboard reordering with screen-reader announcements.
  - Its live region and instructions render inline, inside the `<dialog>`. Do not
    pass `accessibility.container` pointing outside a modal: `showModal()` makes
    the rest of the page inert, and announcements there are never read.
  - Pass the announcements and instructions from `messages.ts`, and
    `roleDescription` to `useSortable`, or dnd-kit's English defaults leak through.
  - Put `touch-none` on the drag handle, so a finger drags the row instead of
    scrolling the list. During a keyboard drag, the sensor cancels Escape's
    `keydown`, so Escape cancels the drag and the dialog stays open.

## Localization readiness

The frontend will be localized; no i18n library has been chosen.

- All copy lives in `i18n/messages.ts`. Strings that carry values are functions
  built with `plural()` and `formatNumber()` from `i18n/format.ts` — no literals
  or concatenated sentences in JSX.
- `LOCALE` is fixed to `'en'` until then, so numbers agree with the English copy.
- `plural()` substitutes `#` in the form it picks, so interpolate user data
  (item or location names) outside plural forms.

## Waiting on backend endpoints

Shopping lists and bulk item actions are specified for the backend but not
built. Until they land:

- "I used it already; add it to shop list" in the remove sheet, and the
  selection's add-to-list action, are shown but inactive.
- Bulk delete and move send one request per item (`PantryStore.deleteItems`,
  `moveItems`); switch them to `POST .../items/bulk-delete` and `bulk-move`.

## Importing from shared

```ts
// zero runtime cost — erased at compile time
import type { CreatePantryItemDto } from '@pantry-pal/shared/dto';

// pulls class-validator + class-transformer + reflect-metadata into the bundle
import { CreatePantryItemDto, validateDto } from '@pantry-pal/shared/dto';
```

`AddItemDialog` uses the **value** import so the browser validates with the same
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
