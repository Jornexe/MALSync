import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { apiKeys, closeDb, getDb } from '../db.js';
import { hashKey } from '../auth.js';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main() {
  const owner = arg('owner');
  const label = arg('label') || 'unnamed';
  if (!owner) {
    console.error('Usage: npm run create-key -- --owner=<ownerId> [--label=<label>]');
    process.exit(1);
  }

  const key = randomBytes(24).toString('hex');
  const db = await getDb();
  await apiKeys(db).insertOne({
    keyHash: hashKey(key),
    ownerId: owner,
    label,
    createdAt: new Date(),
  });

  console.log('API key created. Store this somewhere safe — it will not be shown again.');
  console.log('');
  console.log(`  ownerId: ${owner}`);
  console.log(`  label:   ${label}`);
  console.log(`  key:     ${key}`);
  console.log('');

  await closeDb();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
