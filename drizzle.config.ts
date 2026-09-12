import type { Config } from 'drizzle-kit';
import 'dotenv/config';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Migrations run as the elevated owner role, never as the RLS-bound app role (§7.4).
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL!,
  },
} satisfies Config;
