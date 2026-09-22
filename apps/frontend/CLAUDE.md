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
src/features/auth/         sign-in, sign-up and onboarding pages, route gates, language picker, password form
src/features/profile/      the account's details: fields shared by onboarding and Profile
src/features/shell/        AppShell (sidebar from md up, bottom tab bar below), PageStatus
src/features/storage/      the Storage page: location tabs, search, sort, selection, cards, sheets
src/features/shopping/     the Shopping page, the list picker, the lists editor, sharing as text
src/features/data/         the Data sheet: exporting a backup, importing one or another app's file
src/features/pages.tsx     Planner placeholder, Profile
src/stores/                AuthStore, PantryStore (the household, from the mirror), QuantityUpdates (overlay), NoticeStore
src/offline/               the offline mirror: RxDB database, replication, merge rules, forgetting on sign-out
src/services/              http (fetch), session (tokens), api (REST and sync), socket
src/ui/                    primitives: Dialog, Menu, IconButton, SheetButton, SwipePager, cn
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
- Shopping URL state is `/shopping/:listId`, a tab per list in use like the
  storage spaces'; `/shopping` alone, or an archived or deleted list's URL,
  redirects to the first list in use.
- **Both tab rows are swipeable** (`ui/SwipePager`): a finger dragged sideways
  over the items, or over the entries, changes storage space or shopping list
  and navigates exactly where that tab leads — so the back button walks through
  them however they were reached. See UI primitives below.
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
- Adding an item uses the same form in the same full-screen dialog
  (`AddItemDialog`), so both offer every field. It starts from `emptyDraft`,
  validates `toCreate(draft)` against `CreatePantryItemDto` plus `ruleErrors`,
  lets the quantity step no lower than 1, and asks before discarding a form
  with anything typed into it.
- It opens from the ⋮ menu and from the plus card after the last item of every
  storage space (`AddItemCard`), filled like an item's photo, which is all an
  empty space shows. Either way the form starts in the space on screen. Search
  results leave the card out, since a new item would not be among them.
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

`PantryStore` shows **one household as this device holds it**: an offline mirror
(`src/offline/`, RxDB over IndexedDB, one database per user and household) that
replicates with the server whenever it can reach it. The pages read only the
mirror, so a change shows the same way whoever made it: this tab, another tab,
or another member through the server.

- **The bootstrap stays REST:** the user, their first household (a new "Home"
  for a user with none) and the units, which the service worker answers from its
  cache when offline. The household's mirror opens next, and the pages wait —
  `household` stays `null` — until it holds the household: at once when an
  earlier session synced it (a local document marks that), else after a first
  pull, which needs the server. A first pull that fails shows the load error;
  replication keeps retrying, and the pages appear once it succeeds.
- **Everyday writes are local first:** adding, editing, using up, moving and
  deleting items, and adding, ticking, stepping and removing shopping entries.
  Each lands in the mirror at once, offline too, and resolves once the page shows
  it (`shown`), so nothing flashes its old value. Replication pushes it, and the
  server applies it through its own services. A change the server refuses (an
  archived list, say) is dropped, and a notice gives its reason
  (`errors.changeRefused`).
- **What the server would work out, the store works out too**, so a change reads
  right before it syncs: `effectiveExpiresAt` (`effectiveExpiry` in shared),
  `isEdible` from the category, and running out onto the default list — an entry
  the mirror adds and pushes itself, which the server then leaves to it.
- **Online only:** the storage space and shopping list editors, "Bought", and
  the account's settings stay REST writes. The editors hand the server's answer
  to the mirror (`acceptLocations`, `acceptShoppingLists`), since those two
  collections are only ever pulled; whatever else a REST write changed arrives
  with the next pull.
- **Pulls follow the socket.** A data broadcast, and every reconnect, makes the
  mirror pull from its checkpoints; the broadcast's payload is not applied
  itself, so changes arrive in order. The Refresh menu item pulls too. Household
  events still act directly: a household deleted, or left, opens the next one's
  mirror and deletes the old one from the device.

**Conflicts** (`offline/merge.ts`): a push whose base is stale comes back with
the server's version, and what changed here goes on top of it, field by field. A
quantity is a delta, not a value, so two people's steps add up; a change the
server has already is not applied twice.

**One tab replicates**, the leader (RxDB's leader election); the other tabs share
its database and see its writes. RxDB would also replicate in the visible tab,
which is switched off (`toggleOnDocumentVisible: false`): a quantity pushed from
two tabs could have its delta counted twice. The leader passes refusals on to
the other tabs over a `BroadcastChannel`, since any of them may have made the
change. Entries are pushed after items, as an entry may name an item created
offline.

**A schema change needs `MIRROR_VERSION` raised** (`offline/mirror.ts`): it is
part of the database's name, so the next start pulls everything into a new
database instead of migrating the old one.

Quantities are whole numbers (`@IsInt()` in the shared DTOs, `integer` in the
database), counted in a count unit — `pcs` or a container such as `bottle` or
`bag`; an amount is a size of any kind, `1 bag × 1.5 kg`. So the quantity unit
picker offers count units only, while the size picker groups every kind. Count
units read as plural nouns from the catalog (`messages.units.countNoun`: `2
cans`), and a code the catalog lacks, such as one an admin added, shows its API
label. `pcs` alone is left out beside a size: `2 × 150 g`.

**Stepping a quantity** shows under the finger through `QuantityUpdates`: an
overlay of the quantity being tapped, which cards render with
`quantityOf(item)`. The item changes in the mirror 600 ms after the last tap on
it, one write for a run of taps, so one change is pushed rather than one per
tap, and a list sorted by quantity does not reshuffle while a card is tapped.
The overlay is dropped once the store shows the saved number; a write that fails
drops it too, with a notice.

The mirror holds items of every status, and the store splits them: `items` is the
active ones, and those used up or thrown out leave it. Values are plain objects,
replaced rather than mutated, and `reconcileById` keeps every unchanged one.

`SessionStoreProvider` constructs `SessionStores` in a `useState` lazy
initialiser because it creates a socket — it must not run on every render.
StrictMode's double-mount in development causes one connect/disconnect/connect
cycle; the resulting console warning is expected. `load()` joins a bootstrap
already running, so the double mount does not fetch twice, nor create two
households for a new account.

## Authentication

**Tokens live in localStorage**, under `pantry-pal:session`, so every tab shares
one session: `services/session.ts` owns them. The access token (15 minutes) goes
out as `Authorization: Bearer` and in the socket handshake; the refresh token
(30 days, single-use) buys a new pair at `POST /auth/refresh`.

- **Refreshing is serialised.** The server takes a refresh token spent twice for a
  stolen one and ends the session, so `refreshAccessToken` runs under a Web Lock
  and re-reads storage inside it: a tab that waited uses the pair another tab
  just stored. Within a tab, concurrent callers share one refresh. Signing out
  takes the same lock.
- **When to refresh:** `accessToken()` refreshes a token within 30 seconds of
  expiring before sending it, and `api.ts` refreshes and retries once when a
  request is refused with 401. A refresh the server refuses clears the session;
  anything else, such as no network, keeps it.
- **The socket's `auth` is a function**, so each attempt sends the current token.
  After a 401 handshake, or when the server closes the socket because the
  session ended, `socket.ts` refreshes and connects again. If the session is
  over, the refresh signs the tab out instead.
- **Every tab follows the session.** `AuthStore` subscribes to it, `storage`
  events included, so signing in or out anywhere changes every tab.
  `endedElsewhere` distinguishes a session that ended (expired, or signed out in
  another tab) from this tab's own sign-out, and the sign-in page says so.
- **Stores are per session.** `RootStore` (notices, auth) lives as long as the
  page; `SessionStores` (pantry, quantities) are created by
  `SessionStoreProvider` inside `RequireSession` and disposed when it unmounts,
  so signing out drops the pantry and closes its socket and its mirror.
- **The offline mirrors go with a sign-out, not with a session.** Signing out
  deletes every mirror on the device (`forgetMirrors`), changes not sent yet
  included. A session that merely ends — the refresh token expired during a long
  time offline, or the password changed elsewhere — keeps them: a mirror belongs
  to one user, and its changes go out once that person signs in again.
- **Routes:** `RequireSession` sends a signed-out visitor to `/sign-in`,
  remembering the page in router state (`from`); `GuestOnly` sends a signed-in
  visitor on to it. The sign-in pages validate with the shared DTOs and show
  catalog messages (`authFieldErrors`).
- **Both start with the provider:** `ProviderChoice` offers Google (shown with
  `aria-disabled` until the backend supports it) and email, so a provider is
  added in one place.
- **Sign-in has three steps:** how to sign in, the email, then the password. One
  form holds both inputs throughout, and each step only hides the ones it does
  not use, so a password manager can fill both at any step and the later steps
  show what it filled:
  - Hide with `opacity-0`, out of the layout, plus `inert` — never `hidden` or
    `display: none`, which some managers refuse to fill.
  - Read the values from the inputs, not from state. Autofill does not always
    fire React's events, and Chrome withholds a filled password from scripts
    until the user interacts with the page.
  - On the password step the hidden email is read too: only a manager can change
    it there, and it fills that account's password with it.
  - A different email accepted on a later Continue clears the password, which
    belonged to the previous account.
- **Sign-up has three steps too** (`SIGN_UP_STEPS`), shown as a bar above the
  title: how to sign up, the account, then the onboarding questions.
  - The account step asks only the email and a new password, and creates the
    account. A Google sign-up will confirm the name and email the provider gives
    instead; it is not built.
  - Creating the account there, not after the questions, means a password
    manager saves the password with the form that holds it, a taken email is
    reported beside the field, and leaving mid-onboarding keeps a working account.
  - `AuthStore.signUp` sets `isOnboarding` in the same action that stores the
    session, so `GuestOnly` sends this tab to `/welcome` rather than onward,
    passing `from` along. Other tabs just see a session and skip it. Signing out
    clears the flag.
  - `WelcomePage` (`/welcome`) is signed in, outside the app shell, without the
    language picker. The pantry loads beneath it and creates the household. It
    asks the name, date of birth, units and household name (owners only), all
    prefilled, and which of the new household's storage spaces to keep: only
    while the household holds nothing, and never the fallback. Finish saves
    what changed; Skip saves nothing; both go on to `from`.
- **Development builds** start the email step with `VITE_DEV_USER_EMAIL`
  (default: the seeded test household's owner) and add Sign in without a
  password to the password step. It works only while the backend runs with
  `DEV_AUTH=true`.
- **The Profile page** shows the email, and the household's name to a member.
  `DetailsForm` edits the onboarding questions' answers with the same
  `DetailsFields`: Save is enabled once something changed and sends only that,
  one `PATCH /me` plus a `PATCH` of the household for an owner's new name
  (`PantryStore.saveDetails`). The date of birth may not be after today in the
  user's own calendar, a rule the DTO cannot state. Below come the language,
  the password form when the account has a password (`CurrentUser.hasPassword`),
  and Sign out. Changing the password signs out the account's other devices; a
  wrong current password is a 403, which the form shows, never a 401, which
  would look like an expired token.

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

### Categories

Categories are rows (`GET /categories`), loaded by `refreshCategories` beside
the bootstrap rather than inside it: if they fail to load, the page still works,
with names from the catalog and the item's own category in the picker. Show a
category through `pantry.categoryName(code)` — the catalog's name for a seeded
code (`messages.categories.name`), else the label an admin gave it.

The item form shows the Edible checkbox only for the default category (`other`):
every other category states the value, so choosing one copies its `isEdible`
into the draft, and a patch never sends `isEdible` outside `other` — the server
would refuse a contradicting value.

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
  to the opener. The box is centred by its margins, which needs its height to
  fit the content (`md:h-fit`): a fixed `<dialog>` with `h-auto` stretches to its
  maximum and leaves a short box at the top.
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

### Swiping between tabs — `ui/SwipePager`

The primitive behind both tab rows: a finger dragged sideways over the contents
moves to the next or previous tab's page, with that page's own contents
following the finger the whole way — half a swipe shows half of each. Letting go
finishes the move, which navigates like the tab would (`onSwipe`), or takes it
back. `StoragePage` pages between storage spaces this way, `ShoppingPage`
between shopping lists.

- **The neighbours are real panes**, rendered by the same render prop as the
  open page, so they show what that page actually holds — a space's items,
  searched and sorted as the page asks (`visibleItemsIn`), or a list's entries
  to buy and in the cart (`toBuyAndCart`).
- **Touch and pen only.** A mouse has the tabs, and dragging with one selects
  text. The tabs remain the way there for everyone: the peek panes are
  `pointer-events-none`, `inert` and `aria-hidden`, so they reach neither the tab
  order nor a screen reader, and they are mounted only while a swipe shows them.
- **The page still scrolls and zooms.** `touch-action: pan-y pinch-zoom` leaves
  both to the browser, and a gesture is claimed only once it has travelled
  further sideways than down; a vertical start is let go of for good. A click
  landing just after a swipe is swallowed, so a swipe that ends over a card or a
  row does not open it.
- **`overflow-x: clip`, never `hidden`**, which would make the pager a scroll
  container on both axes and move the page's own vertical scrolling into it.
- **A drag costs no renders:** the offset is written straight to the track's
  `transform`, and React hears about a swipe twice — to mount the neighbours,
  and to settle. So neither page re-renders while a finger moves.
- **The offset is dropped in the frame the new page arrives** (a layout effect
  watching the open page), where its pane stands exactly where the peek pane
  stood: the swap cannot be seen. Anything else that navigates mid-swipe — a tab
  tapped, a space or list deleted — ends the pan the same way.
- Past the first or last tab the panes still give, a little, and spring back:
  there is no wrapping around, as there is none in the tabs.
- **The pager fills the page**, which on both pages is at least a screen tall
  above the phone's tab bar: a space holding one card takes a swipe anywhere
  below it, not only over the card, and a sparse page gains no scrolling of its
  own. A neighbour's pane takes that same height (`inset-y-0` on the track) and
  keeps what does not fit to itself, so bringing it into view never moves the
  page below. Each pane carries the page's padding, which is why the sections
  themselves have none: the panes slide in from the edge of the screen rather
  than from a margin.
- The Shopping page's Bought bar stays put while a swipe runs: it is an action
  on the open list, not its contents, and follows once the swipe lands.

## Localization

The UI speaks English, Ukrainian, Russian, German, French (France and Canada)
and Spanish (`SUPPORTED_LOCALES` in shared: `en-GB`, `uk-UA`, `ru-RU`, `de-DE`,
`fr-FR`, `fr-CA`, `es-ES`), through typed catalogs and no library. A tag is
language, then region: `fr-CA` is French as written in Canada.

- All copy lives in the catalogs. `i18n/messages.ts` holds English, the source,
  and exports `Messages`, its type. Each `i18n/locales/*.ts` translates it with
  `satisfies Messages`, so a key missing from any of them is a type error:
  **add every new string to every catalog.** Components import `messages`, the
  catalog of the page's language, and never a locale file. A new language is a
  tag in `SUPPORTED_LOCALES`, a catalog, an entry in `CATALOGS` and its own name
  in `LANGUAGE_NAMES`. A regional variant spreads its language's catalog and
  overrides only what differs, as `fr-CA.ts` does over `fr.ts`.
- Strings that carry values are functions built with `plural()` and
  `formatNumber()` from `i18n/format.ts` — no literals or concatenated
  sentences in JSX. Ukrainian and Russian plurals need `one`, `few`, `many` and
  `other` forms; German, French and Spanish `one` and `other` (French
  counts 0 and 1.5 as `one`). `plural()` substitutes `#` in the form it picks, so
  interpolate user data (item or location names) outside plural forms, and quote
  it in each language's style («…», „…“, « … ») so a sentence never inflects a
  name it did not write. Write no-break spaces as `\u00A0` escapes: a raw one is
  invisible in an editor.
- **The language is fixed per page load.** `i18n/locale.ts` reads `LOCALE` once,
  and the catalog and every `Intl` formatter use it. It comes from a
  localStorage copy, else the browser's preferred languages
  (`navigator.languages`, on a first visit), else `DEFAULT_LOCALE`.
  `switchLocale(tag)` stores a language and reloads if the page shows another:
  the Profile page calls it after `PATCH /me` saves the choice, and the store
  calls it with the language `GET /me` reports, so the account's `users.locale`
  outranks the copy, as on a new device. With storage blocked it cannot
  remember, so it does not reload.
- **Signed out, the language is this browser's.** `LanguagePicker`, at the foot
  of the sign-in and sign-up pages, changes only the copy. Sign-up and the
  development sign-in send `LOCALE`, so a new account keeps the language it was
  made in and nothing reloads. Signing in to an existing account switches to
  that account's language.
- **User data keeps its language.** Item names and the storage spaces a
  household named stay as typed. A new household's storage spaces arrive
  already named in its creator's language, by the backend, and are user data
  from then on. What the UI names is translated: seeded
  categories (`messages.categories.name`), count-unit nouns, metric unit
  symbols, and the fallback storage space, which nobody can rename
  (`locationName`). Codes the catalogs lack show the API's label.

### Shopping lists

A list names items, so an entry shows the item it names: an active one from
`pantry.items`, and one used up or thrown out from `pantry.offShelfItems`, which
holds exactly the non-active items some entry names. Both come from the mirror's
items, which include every status, so an item that leaves the shelf stays on its
lists.

- **Lists and entries are mirrored** with everything else, so the Shopping page
  works offline: ticking, stepping how many to buy, removing, and adding items
  from Storage.
- **A household starts with a list**, "My shopping list", which the backend names
  in its creator's language. It is an ordinary list, so a household can delete
  every one. The page's empty state and the picker then suggest the same name in
  the page's language (`messages.shopping.defaultListName`).
- **A row's controls ignore presses while its write lands** (`aria-disabled`, so
  focus stays put): a moment, since the write is local.
- **Picking a list** (`AddToListSheet`) serves the selection bar, an item's details
  and "I used it already". It offers the lists in use, marks those the items are on
  already, and can create a list inline — straight away, with a suggested name,
  when the household has none. For a used-up item it sends the consumed status and
  the picked list as the default in one patch; with a default already in use, the
  remove sheet skips the picker and names the list on its button.
- **The item form's "Shopping list"** offers the lists in use and keeps an archived
  default visible as such.
- **The lists editor** (`ShoppingListEditorDialog`, from the + beside the tabs and
  the ⋮ menu) adds, renames, archives, restores and deletes, then saves with one
  `PUT` (`PantryStore.saveShoppingLists`). Its draft is rebased onto the store on
  every render (`shoppingListDraft.ts`), like the locations editor's, and a 409
  refetches for another try. Archived lists sit in their own group below.
- **Archived lists are frozen**, so only the editor shows them: not the tabs, the
  picker, or the item form's choices (`pantry.activeShoppingLists`) — and not the
  swipe, which pages through exactly what the tabs offer.
- **Bought** (the button under the ticked entries, "Bought 2") sends the ticked
  entries shown to the put-away endpoint (`PantryStore.putAwayShopping`), which
  restocks their items and takes them off the list. The copy says what the user
  did, the code what the server does with it, as with storage spaces and
  locations. It is online only, and first waits, briefly, for ticks made here to
  reach the server, which checks them. A 409 means the list changed meanwhile:
  the store pulls and says so.
- **Sharing** (`shareList.ts`) builds the list's name and a line per entry still to
  buy, and hands it to `navigator.share`, which opens the device's share sheet with
  its messengers. Without it (Firefox on a desktop) the text is copied to the
  clipboard, and a notice says so. Only `text` is shared, since some apps paste a
  `title` too.

### The Data sheet

**Data** in the Storage page's ⋮ menu opens `DataDialog`: Export and Import, then
the sources to import from (a Pantry Pal backup, KitchenPal), then one source's
file. The steps are views of one `modal` dialog, full-screen on a phone, with Back
in the header bar there and at the foot from `md` up; every opening starts at the
menu. The backend's `CLAUDE.md` has what a backup holds and how an import matches
what the household has.

- **Both are online REST calls**, like the editors: `PantryStore.exportBackup` and
  `importFile` first wait, briefly, for this device's changes to reach the server,
  so a backup holds them and an import meets the items as they are. After an
  import the store pulls; the broadcasts would bring the same.
- **The export is a download**: `api.exportBackup` reads the answer as a `Blob`
  (`http.receive`), and `saveFile` clicks a `download` link to it. The link goes
  inside the dialog, since a modal dialog makes the rest of the page inert. The
  service worker leaves `/export` out of its read cache: an old backup handed out
  as today's would be worse than none.
- **The file picker is a `label` round a visually hidden input**, so its words come
  from the catalog rather than the browser's own "No file chosen". A file over
  `MAX_IMPORT_FILE_BYTES` is refused before it is sent. `http.send` leaves the
  content type to a `FormData` body, which sets the multipart boundary itself.
- **Refusals are named by their `code`**: `ApiError.code` carries the body's, and
  `importError` in `PantryStore` picks the catalog's words for it; a 413 is "too
  large" whoever sent it, since a proxy in front of the API may.
- **The summary counts the household's items** — new, topped up, restored, already
  here — and lists new storage spaces, items that reached the quantity limit, and
  skipped rows with their reasons. Its heading takes focus, since it replaces the
  form and its button.

### The text assistant: planned

Not built: a sheet where people type, dictate or paste what they did or what a
storage space holds, see Claude's reading of it as tickable changes, and apply
them. The design, and what it waits for, is in the backend's `CLAUDE.md` (Text
assistant: planned).

## Installable, and usable offline

`vite-plugin-pwa` (Workbox) writes a manifest and a service worker into `dist`,
so the app installs to a home screen and opens without a network. **There is no
worker in development**: `pnpm dev` serves the app as before, and a stale cache
can never explain what you see. To exercise it, `pnpm build` then `pnpm preview`
— over `http://localhost`, which some embedded browsers refuse to register a
worker on, Chrome among the ones that allow it.

- **The app itself is precached**: every hashed asset of the build, with
  `index.html` as the navigation fallback, so a deep link opens offline too.
  `start_url` and `scope` follow Vite's `base`, which is `/<repo>/` on Pages.
- **The household itself works offline through the mirror** (State flow);
  the worker only has to start the app and answer the bootstrap.
- **Reads are cached as they arrive** — `NetworkFirst`, the cache
  `pantry-api-reads`, five seconds before it gives up on the network — so the
  bootstrap (the user, households, units, categories) answers offline, and the
  header's Offline badge says why the rest is not live. Sync pulls stay out of
  it, since the mirror keeps its own copy and a cached page would skip changes,
  and so does the export (The Data sheet).
  Writes are never cached: the everyday ones go to the mirror, the rest fail.
  - The cache is keyed by URL alone, so `services/apiCache.ts` empties it
    whenever a session starts or ends (`AuthStore`): the next account to sign in
    on this device must never be shown the last one's pantry.
  - `accessTokenOrStored` in `session.ts` sends the stored token when a refresh
    cannot reach the server, so the read is sent at all and the worker can answer
    it from the cache. A server that does see that token still refuses it with 401.
- **A new build is taken silently, but only while the app is starting**
  (`services/pwa.ts`, registered by `main.tsx` before anyone signs in). Nothing
  is on screen yet, so the reload costs nothing; a build deployed later in a
  session waits for the next start rather than reloading under someone.
- **`workbox-window` is a direct dependency**: the registration module imports
  it, and pnpm's strict layout does not lend out the plugin's own copy.
- **The icons** come from `public/icon.svg` (the storage box, corners rounded)
  and `icons/icon-full-bleed.svg` (edge to edge, for the platforms that mask the
  corners themselves). After changing either, regenerate them:

  ```bash
  pnpm dlx @vite-pwa/assets-generator@1 --preset minimal-2023 public/icon.svg
  pnpm dlx sharp-cli --input icons/icon-full-bleed.svg --output public/maskable-icon-512x512.png resize 512 512
  pnpm dlx sharp-cli --input icons/icon-full-bleed.svg --output public/apple-touch-icon-180x180.png resize 180 180
  ```

  The generator's own maskable and Apple icons are overwritten on purpose: it
  pads them with transparency and white, which those platforms then show as a
  frame around the icon.

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

A built bundle has no proxy. `services/backendOrigin.ts` makes REST and the
socket call `VITE_BACKEND_URL` directly outside development (the page's own
origin when it is unset), so the backend's `CORS_ORIGIN` must list the built
site's origin. The GitHub Pages workflow passes the repository variable of that
name; a value in `.env.local` ends up in local builds too.

Only `VITE_`-prefixed variables reach browser code; unprefixed ones
(`PORT`, `BACKEND_PORT`) are read by the config at startup and stay server-side.
