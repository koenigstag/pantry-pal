import { eq } from 'drizzle-orm';

import type { Database } from '../client';
import { users, type NewUserRow, type UserRow } from '../schema';

export type CreateUserInput = Pick<NewUserRow, 'email' | 'displayName'> &
  Partial<Pick<NewUserRow, 'passwordHash' | 'unitSystem' | 'timezone' | 'locale'>>;

/** The settings a user changes for themselves. An omitted field keeps its value. */
export type UpdateUserInput = Partial<
  Pick<NewUserRow, 'displayName' | 'unitSystem' | 'birthDate' | 'locale'>
>;

export class UsersRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  }

  /**
   * The user, row-locked until the transaction ends. `FOR NO KEY UPDATE`: it
   * serialises changes to the user's own columns without blocking the inserts
   * that reference the user, such as a new household membership.
   */
  async findForUpdate(id: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).for('no key update');
    return row;
  }

  /** `email` must already be lowercased: the unique index compares it verbatim. */
  async findByEmail(email: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row;
  }

  /**
   * Inserts a user. A taken email violates `users_email_unique`: callers check
   * first for a precise message, and the constraint settles a race.
   */
  async create(input: CreateUserInput): Promise<UserRow> {
    const [row] = await this.db.insert(users).values(input).returning();

    if (row === undefined) throw new Error('Insert returned no row');
    return row;
  }

  /**
   * The user with this email, created first if it does not exist yet.
   *
   * Select, then insert-or-nothing, then select again — not `ON CONFLICT DO
   * UPDATE`, which would rewrite the row and bump `updated_at` on every call.
   * Two concurrent first calls are safe: the loser's insert is a no-op, and its
   * final read sees the winner's committed row.
   */
  async findOrCreateByEmail(input: CreateUserInput): Promise<UserRow> {
    const existing = await this.findByEmail(input.email);
    if (existing !== undefined) return existing;

    const [created] = await this.db
      .insert(users)
      .values(input)
      .onConflictDoNothing({ target: users.email })
      .returning();
    if (created !== undefined) return created;

    const winner = await this.findByEmail(input.email);
    if (winner === undefined) throw new Error(`User ${input.email} vanished while being created`);
    return winner;
  }

  /** Kept apart from `update`, so a settings patch can never carry a credential. */
  async setPasswordHash(id: string, passwordHash: string): Promise<UserRow | undefined> {
    const [row] = await this.db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, id))
      .returning();

    return row;
  }

  async update(id: string, patch: UpdateUserInput): Promise<UserRow | undefined> {
    // An empty SET is an error in Drizzle; an empty patch is a no-op here.
    if (Object.values(patch).every((value) => value === undefined)) return this.findById(id);

    const [row] = await this.db.update(users).set(patch).where(eq(users.id, id)).returning();
    return row;
  }
}
