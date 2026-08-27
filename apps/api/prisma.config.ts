import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Prisma 7 registers the seed command here, not under package.json#prisma.
    //
    // Run with tsx, not ts-node: the Prisma 7 client uses `import.meta.url`,
    // which TypeScript emits verbatim into otherwise-CommonJS output. That one
    // token makes Node treat the file as ESM and then fail on `exports`. tsx
    // resolves the mixed module graph correctly.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
