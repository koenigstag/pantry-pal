import { defineConfig } from 'tsup';

export default defineConfig({
  // Two entry points, two published subpaths: the root barrel stays free of
  // runtime dependencies, `/dto` carries the decorated validation classes.
  entry: ['src/index.ts', 'src/dto/index.ts'],
  // Dual output: the NestJS backend consumes CJS, Vite/Rollup consumes ESM.
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2023',
  outDir: 'dist',
});
