import { defineConfig } from 'tsup';

export default defineConfig({
  // Three entry points: the client/repositories; the raw schema, for tooling and
  // for consumers that only want table definitions; and the development
  // fixtures, kept separate so seed data never enters the main import graph.
  entry: ['src/index.ts', 'src/schema/index.ts', 'src/fixtures/index.ts'],
  // ESM only. Unlike `@pantry-pal/shared`, this package has no browser consumer
  // and only one server consumer, which reaches it through Node's require(esm)
  // support — the same path it already uses for NestJS 12 itself.
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2023',
  outDir: 'dist',
  // Never bundle the driver: pg loads native/optional bits at runtime.
  external: ['pg', 'drizzle-orm'],
});
