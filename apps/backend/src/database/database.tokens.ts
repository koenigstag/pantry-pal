/** The `pg` pool and raw Drizzle client. Only the database module itself should need it. */
export const DATABASE_HANDLE = Symbol('DATABASE_HANDLE');

/** The transactional proxy every repository is built on. */
export const DATABASE = Symbol('DATABASE');
