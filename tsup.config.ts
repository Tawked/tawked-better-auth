import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/client.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  target: 'es2022',
  platform: 'neutral',
  treeshake: true,
  external: ['better-auth', '@tawked/sdk'],
});
