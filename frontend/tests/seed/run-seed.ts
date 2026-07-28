import { Client } from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function seed() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/payroll_test',
  });
  await client.connect();
  const sql = readFileSync(join(__dirname, 'legacy-payroll.sql'), 'utf8');
  await client.query(sql);
  await client.end();
  console.log('Seed complete');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
