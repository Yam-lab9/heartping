// Integration tests intentionally require a real hosted Supabase project.
// They never substitute a mock, local database, or JSON file for persistence.
import fs from 'node:fs';
if (fs.existsSync('.env')) process.loadEnvFile('.env');
export const hosted = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
export const hostedOptions = {
  skip: hosted ? false : 'Hosted Supabase is not configured; apply the SQL migration and set both SUPABASE_* variables.'
};
