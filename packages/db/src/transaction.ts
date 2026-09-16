import { AsyncLocalStorage } from 'node:async_hooks';

import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction, PgTransactionConfig } from 'drizzle-orm/pg-core';

import type { Database } from './client';
import type * as schema from './schema';

export type Transaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/** A transaction and the pool are interchangeable at every call site. */
export type Executor = Database | Transaction;

export const PROPAGATION = {
  /** Join the active transaction, or start one. The default. */
  Required: 'REQUIRED',
  /** Always a fresh transaction on its own connection; the outer one is suspended. */
  RequiresNew: 'REQUIRES_NEW',
  /** Throw if there is no active transaction. */
  Mandatory: 'MANDATORY',
  /** SAVEPOINT inside the active transaction, so it can roll back on its own. */
  Nested: 'NESTED',
} as const;

export type Propagation = (typeof PROPAGATION)[keyof typeof PROPAGATION];

export interface TransactionalOptions {
  propagation?: Propagation;
  isolationLevel?: PgTransactionConfig['isolationLevel'];
}

const txStorage = new AsyncLocalStorage<Transaction>();

let defaultRoot: Database | undefined;

/** The executor in force right now: the active transaction, else the pool. */
export const currentExecutor = (fallback: Database): Executor => txStorage.getStore() ?? fallback;

/** Whether a transaction is currently in scope. Useful in assertions and tests. */
export const isTransactionActive = (): boolean => txStorage.getStore() !== undefined;

/**
 * Wraps a database so that every property access resolves against the active
 * transaction, falling back to the pool. Repositories hold this and never learn
 * whether they are inside a transaction — which is the whole point.
 *
 * Also registers `root` as the database `@Transactional()` opens transactions
 * on. A process with two databases must call `runInTransaction` with an explicit
 * `db` instead of relying on the decorator.
 */
export function createTransactionalDatabase(root: Database): Database {
  defaultRoot = root;

  return new Proxy(root, {
    get(target, property) {
      const active: object = txStorage.getStore() ?? target;
      const value: unknown = Reflect.get(active, property, active);

      // Bind to the real object, never to the proxy: Drizzle reads private
      // fields internally, and those throw when `this` is a Proxy.
      return typeof value === 'function' ? value.bind(active) : value;
    },
  });
}

export async function runInTransaction<T>(
  fn: () => Promise<T>,
  { propagation = PROPAGATION.Required, isolationLevel }: TransactionalOptions = {},
  db?: Database,
): Promise<T> {
  const active = txStorage.getStore();
  const root = db ?? defaultRoot;
  const config: PgTransactionConfig | undefined =
    isolationLevel === undefined ? undefined : { isolationLevel };

  if (propagation === PROPAGATION.Mandatory) {
    if (active === undefined) {
      throw new Error(
        'A transaction is required here but none is active. Either the caller forgot ' +
          '@Transactional(), or async context was lost on the way in.',
      );
    }
    return fn();
  }

  if (propagation === PROPAGATION.Nested && active !== undefined) {
    return active.transaction((savepoint) => txStorage.run(savepoint as Transaction, fn));
  }

  if (propagation === PROPAGATION.Required && active !== undefined) {
    return fn();
  }

  if (root === undefined) {
    throw new Error(
      'No database registered. Call createTransactionalDatabase() first, or pass one explicitly.',
    );
  }

  const start = () => root.transaction((tx) => txStorage.run(tx, fn), config);

  // REQUIRES_NEW must not inherit the outer transaction's connection.
  return propagation === PROPAGATION.RequiresNew ? txStorage.exit(start) : start();
}

/**
 * Declares a transaction boundary on a service method.
 *
 * Legacy decorator form on purpose: the backend sets `experimentalDecorators`
 * for Nest, and a decorator authored against the TC39 standard signature is
 * called differently and would break there.
 */
export function Transactional(options: TransactionalOptions = {}) {
  return function decorate(
    _target: object,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const original: unknown = descriptor.value;

    if (typeof original !== 'function') {
      throw new TypeError('@Transactional() can only decorate a method.');
    }

    descriptor.value = function transactional(this: unknown, ...args: unknown[]): Promise<unknown> {
      return runInTransaction(
        () => Reflect.apply(original, this, args) as Promise<unknown>,
        options,
      );
    };

    return descriptor;
  };
}
