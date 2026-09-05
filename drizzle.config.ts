import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  driver: 'pglite',
  schema: './src/lib/db/schema.ts',
  out: './src/lib/db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? './.pglite' },
  strict: true,
  verbose: true,
});
