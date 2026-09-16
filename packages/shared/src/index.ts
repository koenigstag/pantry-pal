/**
 * Browser- and server-safe surface: plain constants, types and pure functions,
 * with no runtime dependencies.
 *
 * The request DTOs deliberately live behind `@pantry-pal/shared/dto` instead of
 * this barrel. They carry `class-validator` decorators that call
 * `Reflect.getMetadata` as soon as the module is evaluated, so re-exporting them
 * here would drag `reflect-metadata` into every consumer — including the browser
 * bundle and Vite's own config loader.
 */
export * from './constants';
export * from './events';
export * from './settings';
export * from './types';
export * from './utils';
