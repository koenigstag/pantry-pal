/**
 * The decorators in this module call `Reflect.getMetadata` as soon as the module
 * body is evaluated, and `Reflect.getMetadata` is not part of JavaScript — it is
 * installed by the `reflect-metadata` polyfill.
 *
 * Importing the polyfill *here* rather than asking every consumer to import it
 * first makes this entry self-contained: it cannot be broken by an import-order
 * mistake in an app, and the browser only pays for it if it imports this subpath
 * as a value. `import type` consumers still get everything erased.
 */
import 'reflect-metadata';

export * from './category.dto';
export * from './decorators';
export * from './household.dto';
export * from './location.dto';
export * from './me.dto';
export * from './pantry-item.dto';
export * from './settings.dto';
export * from './unit.dto';
export * from './validate';
