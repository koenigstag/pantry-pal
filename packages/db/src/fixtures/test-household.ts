import {
  createId,
  daysUntil,
  DEFAULT_CATEGORY,
  DEFAULT_LOCATIONS,
  EXPIRY_WARNING_DAYS,
  HOUSEHOLD_ROLE,
  ITEM_EVENT_TYPE,
  ITEM_STATUS,
  type HouseholdRole,
  type ItemStatus,
  type UnitSystemPreference,
} from '@pantry-pal/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '../client';
import {
  householdMembers,
  households,
  itemEvents,
  items,
  products,
  users,
  type NewItemEventRow,
  type NewItemRow,
} from '../schema';
import { CATEGORY_SEED, seedCategories, seedDefaultLocations, seedUnits } from '../seed';

/**
 * A realistic household for local development: every default location in use,
 * every expiry state represented, opened items whose period-after-opening beats
 * their printed date, imperial units, one product stocked in two batches,
 * consumed and discarded history, and a soft-deleted tombstone.
 *
 * Every date is an offset from the moment the seed runs, never a calendar date,
 * so "expired yesterday" is still expired yesterday whenever it is re-seeded.
 */

/** Stable across re-runs, so a frontend or a test can point straight at it. */
export const TEST_HOUSEHOLD_ID = '00000000-0000-4000-8000-000000000001';
export const TEST_HOUSEHOLD_NAME = 'Test Household';

/**
 * The `.test` TLD is reserved for testing (RFC 6761), so these addresses can
 * never reach a real inbox. The two members prefer different unit systems so
 * the per-user picker has something to disagree about.
 */
export const TEST_USERS = {
  owner: {
    email: 'owner@pantry-pal.test',
    displayName: 'Test Owner',
    unitSystem: 'metric',
    role: HOUSEHOLD_ROLE.Owner,
  },
  member: {
    email: 'member@pantry-pal.test',
    displayName: 'Test Member',
    unitSystem: 'imperial',
    role: HOUSEHOLD_ROLE.Member,
  },
} as const satisfies Record<
  string,
  { email: string; displayName: string; unitSystem: UnitSystemPreference; role: HouseholdRole }
>;

type Actor = keyof typeof TEST_USERS;

interface ProductFixture {
  name: string;
  brand: string;
  /** A count unit: what one batch of this product is counted in. */
  defaultUnit: string;
  /** A category code from `CATEGORY_SEED`. */
  defaultCategory: string;
  defaultShelfLifeDays: number;
}

const PRODUCTS = {
  tomatoes: {
    name: 'Chopped tomatoes',
    brand: 'Casa Verde',
    defaultUnit: 'can',
    defaultCategory: 'canned',
    defaultShelfLifeDays: 730,
  },
  milk: {
    name: 'Whole milk',
    brand: 'Northfield Dairy',
    defaultUnit: 'bottle',
    defaultCategory: 'dairy',
    defaultShelfLifeDays: 10,
  },
  spaghetti: {
    name: 'Spaghetti',
    brand: 'Pasta Nonna',
    defaultUnit: 'pack',
    defaultCategory: 'grains',
    defaultShelfLifeDays: 1095,
  },
  cola: {
    name: 'Cola',
    brand: 'Fizz Co',
    defaultUnit: 'can',
    defaultCategory: 'beverages',
    defaultShelfLifeDays: 270,
  },
  sunscreen: {
    name: 'Sunscreen SPF 50',
    brand: 'SunCare',
    defaultUnit: 'tube',
    defaultCategory: 'personal-care',
    defaultShelfLifeDays: 730,
  },
  ibuprofen: {
    name: 'Ibuprofen 200 mg',
    brand: 'MediCo',
    defaultUnit: 'blister',
    defaultCategory: 'medicine',
    defaultShelfLifeDays: 1095,
  },
} as const satisfies Record<string, ProductFixture>;

interface ItemFixture {
  name: string;
  location: (typeof DEFAULT_LOCATIONS)[number];
  /** A category code from `CATEGORY_SEED`. */
  category: string;
  /** Only for the default category, where each item decides; others copy their category's. */
  isEdible?: boolean;
  quantity: number;
  unit: string;
  /** What is inside one of them: `[300, 'ml']` is the `300 ml` in `1 can 300 ml`. */
  size?: readonly [value: number, unit: string];
  product?: keyof typeof PRODUCTS;
  /** Printed date, in days from today. Omitted for things with no date at all. */
  expiresIn?: number;
  openedDaysAgo?: number;
  /** Period after opening, in days: the "12M" symbol on a jar is 365. */
  paoDays?: number;
  addedDaysAgo: number;
  addedBy?: Actor;
  status?: ItemStatus;
  deletedDaysAgo?: number;
  notes?: string;
}

/**
 * Comments mark every row whose effective state differs from what its printed
 * date alone suggests. Those are the rows that expose a UI reading
 * `expires_at` instead of `effective_expires_at`.
 */
const ITEMS: readonly ItemFixture[] = [
  // Kitchen
  {
    name: 'Bananas',
    location: 'Kitchen',
    category: 'produce',
    quantity: 5,
    unit: 'pcs',
    expiresIn: 2,
    addedDaysAgo: 3,
  },
  // Printed date 18 months out, but opened a month ago with 90 days to use it.
  {
    name: 'Olive oil',
    location: 'Kitchen',
    category: 'other',
    quantity: 1,
    unit: 'bottle',
    size: [750, 'ml'],
    expiresIn: 540,
    openedDaysAgo: 30,
    paoDays: 90,
    addedDaysAgo: 45,
  },
  {
    name: 'Dish soap',
    location: 'Kitchen',
    category: 'cleaning',
    quantity: 1,
    unit: 'bottle',
    size: [500, 'ml'],
    addedDaysAgo: 20,
  },
  {
    name: 'Sourdough bread',
    location: 'Kitchen',
    category: 'grains',
    quantity: 1,
    unit: 'pcs',
    expiresIn: -2,
    addedDaysAgo: 6,
    addedBy: 'member',
    status: ITEM_STATUS.Discarded,
    notes: 'Went mouldy',
  },

  // Fridge
  // Printed date says fresh; "use within 4 days" of opening two days ago says expiring soon.
  {
    name: 'Whole milk',
    product: 'milk',
    location: 'Fridge',
    category: 'dairy',
    quantity: 1,
    unit: 'bottle',
    size: [1, 'l'],
    expiresIn: 5,
    openedDaysAgo: 2,
    paoDays: 4,
    addedDaysAgo: 3,
  },
  {
    name: 'Whole milk',
    product: 'milk',
    location: 'Fridge',
    category: 'dairy',
    quantity: 1,
    unit: 'bottle',
    size: [1, 'l'],
    expiresIn: 6,
    addedDaysAgo: 3,
  },
  {
    name: 'Greek yogurt',
    location: 'Fridge',
    category: 'dairy',
    quantity: 2,
    unit: 'pcs',
    size: [150, 'g'],
    expiresIn: -1,
    addedDaysAgo: 9,
  },
  {
    name: 'Cheddar',
    location: 'Fridge',
    category: 'dairy',
    quantity: 1,
    unit: 'pack',
    size: [200, 'g'],
    expiresIn: 45,
    openedDaysAgo: 5,
    paoDays: 21,
    addedDaysAgo: 7,
  },
  {
    name: 'Eggs',
    location: 'Fridge',
    category: 'dairy',
    quantity: 10,
    unit: 'pcs',
    expiresIn: 12,
    addedDaysAgo: 4,
  },
  {
    name: 'Eggs',
    location: 'Fridge',
    category: 'dairy',
    quantity: 10,
    unit: 'pcs',
    expiresIn: 12,
    addedDaysAgo: 4,
    deletedDaysAgo: 3,
    notes: 'Added twice by mistake',
  },
  {
    name: 'Chicken breast',
    location: 'Fridge',
    category: 'meat',
    quantity: 1,
    unit: 'pack',
    size: [1, 'lb'],
    expiresIn: 0,
    addedDaysAgo: 2,
    addedBy: 'member',
  },
  {
    name: 'Orange juice',
    location: 'Fridge',
    category: 'beverages',
    quantity: 1,
    unit: 'bottle',
    size: [1, 'l'],
    expiresIn: 3,
    openedDaysAgo: 6,
    paoDays: 7,
    addedDaysAgo: 8,
    status: ITEM_STATUS.Consumed,
  },

  // Freezer
  {
    name: 'Frozen peas',
    location: 'Freezer',
    category: 'frozen',
    quantity: 1,
    unit: 'bag',
    size: [1, 'kg'],
    expiresIn: 240,
    addedDaysAgo: 30,
  },
  {
    name: 'Vanilla ice cream',
    location: 'Freezer',
    category: 'frozen',
    quantity: 1,
    unit: 'box',
    size: [500, 'ml'],
    expiresIn: 90,
    openedDaysAgo: 20,
    addedDaysAgo: 35,
  },

  // Pantry — one product in two batches with very different dates.
  {
    name: 'Chopped tomatoes',
    product: 'tomatoes',
    location: 'Pantry',
    category: 'canned',
    quantity: 2,
    unit: 'can',
    size: [400, 'g'],
    expiresIn: 20,
    addedDaysAgo: 60,
  },
  {
    name: 'Chopped tomatoes',
    product: 'tomatoes',
    location: 'Pantry',
    category: 'canned',
    quantity: 1,
    unit: 'can',
    size: [400, 'g'],
    expiresIn: 400,
    addedDaysAgo: 10,
  },
  {
    name: 'Spaghetti',
    product: 'spaghetti',
    location: 'Pantry',
    category: 'grains',
    quantity: 2,
    unit: 'pack',
    size: [500, 'g'],
    expiresIn: 300,
    addedDaysAgo: 25,
  },
  {
    name: 'Rice',
    location: 'Pantry',
    category: 'grains',
    quantity: 1,
    unit: 'bag',
    size: [2, 'kg'],
    expiresIn: 600,
    addedDaysAgo: 40,
  },
  // Quantities are whole and counted: 1.5 kg of flour is one bag with a size.
  {
    name: 'Flour',
    location: 'Pantry',
    category: 'grains',
    quantity: 1,
    unit: 'bag',
    size: [1.5, 'kg'],
    expiresIn: 150,
    addedDaysAgo: 15,
  },
  {
    name: 'Salt',
    location: 'Pantry',
    category: 'other',
    quantity: 1,
    unit: 'pack',
    size: [1, 'kg'],
    addedDaysAgo: 100,
  },
  {
    name: 'Honey',
    location: 'Pantry',
    category: 'other',
    quantity: 1,
    unit: 'jar',
    size: [12, 'oz'],
    addedDaysAgo: 50,
    addedBy: 'member',
  },
  {
    name: 'Cola',
    product: 'cola',
    location: 'Pantry',
    category: 'beverages',
    quantity: 6,
    unit: 'can',
    size: [12, 'fl_oz_us'],
    expiresIn: 150,
    addedDaysAgo: 12,
    addedBy: 'member',
  },

  // Spices
  {
    name: 'Smoked paprika',
    location: 'Spices',
    category: 'spices',
    quantity: 1,
    unit: 'jar',
    size: [75, 'g'],
    expiresIn: 700,
    openedDaysAgo: 200,
    paoDays: 365,
    addedDaysAgo: 210,
  },
  {
    name: 'Cinnamon',
    location: 'Spices',
    category: 'spices',
    quantity: 1,
    unit: 'jar',
    size: [40, 'g'],
    expiresIn: -30,
    addedDaysAgo: 400,
  },
  {
    name: 'Black pepper',
    location: 'Spices',
    category: 'spices',
    quantity: 1,
    unit: 'jar',
    size: [100, 'g'],
    addedDaysAgo: 90,
  },

  // Bathroom
  // The showcase row: printed date well over a year away, yet expired — opened
  // 190 days ago with a 6-month period after opening.
  {
    name: 'Mascara',
    location: 'Bathroom',
    category: 'personal-care',
    quantity: 1,
    unit: 'tube',
    size: [8, 'ml'],
    expiresIn: 500,
    openedDaysAgo: 190,
    paoDays: 180,
    addedDaysAgo: 200,
  },
  {
    name: 'Toothpaste',
    location: 'Bathroom',
    category: 'personal-care',
    quantity: 1,
    unit: 'tube',
    size: [75, 'ml'],
    expiresIn: 300,
    openedDaysAgo: 40,
    paoDays: 365,
    addedDaysAgo: 50,
  },
  {
    name: 'Shampoo',
    location: 'Bathroom',
    category: 'personal-care',
    quantity: 1,
    unit: 'bottle',
    size: [400, 'ml'],
    expiresIn: 700,
    openedDaysAgo: 60,
    paoDays: 365,
    addedDaysAgo: 65,
  },
  {
    name: 'Sunscreen SPF 50',
    product: 'sunscreen',
    location: 'Bathroom',
    category: 'personal-care',
    quantity: 1,
    unit: 'tube',
    size: [200, 'ml'],
    expiresIn: 500,
    openedDaysAgo: 100,
    paoDays: 365,
    addedDaysAgo: 120,
  },

  // Medicines — dosage lives in `notes` until medicine metadata gets real columns.
  {
    name: 'Ibuprofen 200 mg',
    product: 'ibuprofen',
    location: 'Medicines',
    category: 'medicine',
    quantity: 2,
    unit: 'blister',
    size: [10, 'pill'],
    expiresIn: 400,
    addedDaysAgo: 30,
    notes: '200 mg per pill',
  },
  {
    name: 'Paracetamol 500 mg',
    location: 'Medicines',
    category: 'medicine',
    quantity: 1,
    unit: 'box',
    size: [16, 'pill'],
    expiresIn: -5,
    addedDaysAgo: 300,
    notes: '500 mg per pill',
  },
  // Printed date a year out; opened 28 days ago with a 30-day limit, so expiring soon.
  {
    name: 'Cough syrup',
    location: 'Medicines',
    category: 'medicine',
    quantity: 1,
    unit: 'bottle',
    size: [100, 'ml'],
    expiresIn: 400,
    openedDaysAgo: 28,
    paoDays: 30,
    addedDaysAgo: 90,
  },
  {
    name: 'Plasters',
    location: 'Medicines',
    category: 'medicine',
    quantity: 20,
    unit: 'pcs',
    expiresIn: 900,
    addedDaysAgo: 150,
  },

  // Other
  {
    name: 'Laundry detergent',
    location: 'Other',
    category: 'cleaning',
    quantity: 1,
    unit: 'bottle',
    size: [2, 'l'],
    addedDaysAgo: 14,
  },
  {
    name: 'AA batteries',
    location: 'Other',
    category: 'other',
    isEdible: false,
    quantity: 4,
    unit: 'pcs',
    expiresIn: 1500,
    addedDaysAgo: 60,
  },
];

export interface TestHouseholdSummary {
  householdId: string;
  members: { email: string; role: HouseholdRole; unitSystem: UnitSystemPreference }[];
  locations: number;
  products: number;
  items: { active: number; consumed: number; discarded: number; deleted: number };
  /** Active items, classified from `effective_expires_at` as read back from Postgres. */
  expiry: { expired: number; expiringSoon: number; fresh: number; noDate: number };
  events: number;
}

export interface SeedTestHouseholdOptions {
  /** The moment every relative date is measured from. Defaults to now. */
  now?: Date;
}

const MS_PER_DAY = 86_400_000;

/** Consumed and discarded fixtures changed status this many days ago. */
const STATUS_CHANGED_DAYS_AGO = 1;

/** `YYYY-MM-DD` for the UTC day `offset` days from `now` — the shape a `date` column takes. */
const isoDay = (now: Date, offset: number): string =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset))
    .toISOString()
    .slice(0, 10);

const daysAgo = (now: Date, days: number): Date => new Date(now.getTime() - days * MS_PER_DAY);

/**
 * A valid EAN-13 in GS1's restricted-circulation range (leading `2`), which is
 * never issued as a global product number — so a fixture barcode cannot
 * collide with anything a real product catalog would return for a scan.
 */
const fixtureBarcode = (n: number): string => {
  const body = `20${String(n).padStart(10, '0')}`;
  const sum = [...body].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return `${body}${(10 - (sum % 10)) % 10}`;
};

/** Every lookup is over rows inserted moments earlier, so a miss means a fixture typo. */
const required = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) {
    throw new Error(`Test household fixture references an unknown ${what}.`);
  }
  return value;
};

const SEEDED_CATEGORIES = new Map(CATEGORY_SEED.map((category) => [category.code, category]));

/** The rule the items service applies: the category's value, or the item's own in `other`. */
const edibleFor = (fixture: ItemFixture): boolean => {
  const category = required(
    SEEDED_CATEGORIES.get(fixture.category),
    `category ${fixture.category}`,
  );
  return category.code === DEFAULT_CATEGORY
    ? (fixture.isEdible ?? category.isEdible)
    : category.isEdible;
};

/**
 * Resets and re-creates the test household in a single transaction.
 *
 * The reset is one DELETE: locations, products, items, events and memberships
 * all cascade from the household row. Users are upserted instead of deleted,
 * because removing one would cascade into its refresh tokens and quietly sign a
 * developer out. If anything fails, the previous household is left intact.
 */
export function seedTestHousehold(
  db: Database,
  { now = new Date() }: SeedTestHouseholdOptions = {},
): Promise<TestHouseholdSummary> {
  return db.transaction(async (tx) => {
    // Restores any default unit or category an admin deleted that the items below use.
    await seedUnits(tx);
    await seedCategories(tx);

    const userRows = await tx
      .insert(users)
      .values(
        Object.values(TEST_USERS).map(({ email, displayName, unitSystem }) => ({
          email,
          displayName,
          unitSystem,
        })),
      )
      .onConflictDoUpdate({
        target: users.email,
        set: { displayName: sql`excluded.display_name`, unitSystem: sql`excluded.unit_system` },
      })
      .returning({ id: users.id, email: users.email });

    const userIdByEmail = new Map(userRows.map((row) => [row.email, row.id]));
    const userId = (actor: Actor): string =>
      required(userIdByEmail.get(TEST_USERS[actor].email), `user ${actor}`);

    await tx.delete(households).where(eq(households.id, TEST_HOUSEHOLD_ID));
    await tx.insert(households).values({
      id: TEST_HOUSEHOLD_ID,
      name: TEST_HOUSEHOLD_NAME,
      createdBy: userId('owner'),
      createdAt: daysAgo(now, Math.max(...ITEMS.map((item) => item.addedDaysAgo))),
    });

    const actors = Object.keys(TEST_USERS) as Actor[];
    await tx.insert(householdMembers).values(
      actors.map((actor) => ({
        householdId: TEST_HOUSEHOLD_ID,
        userId: userId(actor),
        role: TEST_USERS[actor].role,
      })),
    );

    const locationRows = await seedDefaultLocations(tx, TEST_HOUSEHOLD_ID);
    const locationIdByName = new Map(locationRows.map((row) => [row.name, row.id]));

    const productRows = await tx
      .insert(products)
      .values(
        Object.values(PRODUCTS).map((product, index) => ({
          name: product.name,
          brand: product.brand,
          defaultCategory: product.defaultCategory,
          defaultShelfLifeDays: product.defaultShelfLifeDays,
          householdId: TEST_HOUSEHOLD_ID,
          defaultUnit: product.defaultUnit,
          barcode: fixtureBarcode(index + 1),
        })),
      )
      .returning({ id: products.id, name: products.name });

    // Keyed by name rather than position: Postgres does not promise that
    // RETURNING preserves the order of a multi-row VALUES list.
    const productIdByName = new Map(productRows.map((row) => [row.name, row.id]));

    const itemRows: NewItemRow[] = [];
    const eventRows: NewItemEventRow[] = [];

    for (const fixture of ITEMS) {
      if (fixture.openedDaysAgo !== undefined && fixture.openedDaysAgo > fixture.addedDaysAgo) {
        throw new Error(`Fixture "${fixture.name}" is opened before it was added.`);
      }

      const id = createId();
      const status = fixture.status ?? ITEM_STATUS.Active;
      const actorId = userId(fixture.addedBy ?? 'owner');
      const createdAt = daysAgo(now, fixture.addedDaysAgo);
      const lastTouchedDaysAgo = Math.min(
        ...[
          fixture.addedDaysAgo,
          fixture.openedDaysAgo,
          status === ITEM_STATUS.Active ? undefined : STATUS_CHANGED_DAYS_AGO,
          fixture.deletedDaysAgo,
        ].filter((days) => days !== undefined),
      );

      itemRows.push({
        id,
        householdId: TEST_HOUSEHOLD_ID,
        productId:
          fixture.product === undefined
            ? null
            : required(productIdByName.get(PRODUCTS[fixture.product].name), fixture.product),
        name: fixture.name,
        locationId: required(locationIdByName.get(fixture.location), fixture.location),
        category: fixture.category,
        isEdible: edibleFor(fixture),
        quantity: fixture.quantity,
        unit: fixture.unit,
        sizeValue: fixture.size?.[0] ?? null,
        sizeUnit: fixture.size?.[1] ?? null,
        expiresAt: fixture.expiresIn === undefined ? null : isoDay(now, fixture.expiresIn),
        openedAt: fixture.openedDaysAgo === undefined ? null : isoDay(now, -fixture.openedDaysAgo),
        periodAfterOpeningDays: fixture.paoDays ?? null,
        notes: fixture.notes ?? null,
        status,
        createdAt,
        updatedAt: daysAgo(now, lastTouchedDaysAgo),
        deletedAt:
          fixture.deletedDaysAgo === undefined ? null : daysAgo(now, fixture.deletedDaysAgo),
      });

      const event = { householdId: TEST_HOUSEHOLD_ID, itemId: id, userId: actorId };

      eventRows.push({
        ...event,
        type: ITEM_EVENT_TYPE.Added,
        quantityDelta: fixture.quantity,
        createdAt,
      });

      if (fixture.openedDaysAgo !== undefined) {
        eventRows.push({
          ...event,
          type: ITEM_EVENT_TYPE.Opened,
          createdAt: daysAgo(now, fixture.openedDaysAgo),
        });
      }

      if (status !== ITEM_STATUS.Active) {
        eventRows.push({
          ...event,
          type:
            status === ITEM_STATUS.Consumed ? ITEM_EVENT_TYPE.Consumed : ITEM_EVENT_TYPE.Discarded,
          quantityDelta: -fixture.quantity,
          createdAt: daysAgo(now, STATUS_CHANGED_DAYS_AGO),
        });
      }
    }

    await tx.insert(items).values(itemRows);
    await tx.insert(itemEvents).values(eventRows);

    // Read the generated column back rather than recomputing it here, so the
    // summary reports what Postgres actually stored.
    const active = await tx
      .select({ effectiveExpiresAt: items.effectiveExpiresAt })
      .from(items)
      .where(
        and(
          eq(items.householdId, TEST_HOUSEHOLD_ID),
          isNull(items.deletedAt),
          eq(items.status, ITEM_STATUS.Active),
        ),
      );

    // Same thresholds as `getExpiryStatus` in @pantry-pal/shared.
    const expiry = { expired: 0, expiringSoon: 0, fresh: 0, noDate: 0 };
    for (const { effectiveExpiresAt } of active) {
      if (effectiveExpiresAt === null) {
        expiry.noDate += 1;
        continue;
      }
      const days = daysUntil(effectiveExpiresAt, now);
      if (days < 0) expiry.expired += 1;
      else if (days <= EXPIRY_WARNING_DAYS) expiry.expiringSoon += 1;
      else expiry.fresh += 1;
    }

    const countWhere = (predicate: (fixture: ItemFixture) => boolean): number =>
      ITEMS.filter(predicate).length;

    return {
      householdId: TEST_HOUSEHOLD_ID,
      members: actors.map((actor) => ({
        email: TEST_USERS[actor].email,
        role: TEST_USERS[actor].role,
        unitSystem: TEST_USERS[actor].unitSystem,
      })),
      locations: locationRows.length,
      products: productRows.length,
      items: {
        active: active.length,
        consumed: countWhere((fixture) => fixture.status === ITEM_STATUS.Consumed),
        discarded: countWhere((fixture) => fixture.status === ITEM_STATUS.Discarded),
        deleted: countWhere((fixture) => fixture.deletedDaysAgo !== undefined),
      },
      expiry,
      events: eventRows.length,
    };
  });
}
