import { defineConfig } from 'vitest/config';
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  // `.ts` as well as `.tsx`: the live turn's folding rule is plain TypeScript,
  // and it is worth testing without a screen.
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
