import { Client } from 'pg';

async function inspect() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();

  // Find users without payroll profiles
  const available = await client.query(`
    SELECT u.id, u.name, u.email
    FROM users u
    LEFT JOIN payroll_profiles pp ON pp.user_id = u.id AND pp.organization_id = 30
    WHERE pp.id IS NULL
    ORDER BY u.id
    LIMIT 5
  `);
  console.log('Users without payroll_profiles:');
  for (const u of available.rows) {
    console.log(`- ${u.id}: ${u.name} (${u.email})`);
  }

  await client.end();
}

inspect().catch((err) => {
  console.error(err);
  process.exit(1);
});
