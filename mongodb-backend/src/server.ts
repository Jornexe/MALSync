import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import { authMiddleware } from './auth.js';
import { getDb } from './db.js';
import {
  deleteEntry,
  linkEntries,
  listEntries,
  unlinkEntries,
  upsertEntry,
} from './entries.js';

const app = new Hono();

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'X-API-Key'] }));

// gzip/deflate the (large) entries payload. The list view downloads hundreds of
// rows at once, and the JSON compresses ~5-10x, which is the main remaining
// load-time cost over higher-latency links.
app.use('*', compress());

app.get('/health', c => c.json({ ok: true }));

app.use('/me', authMiddleware);
app.use('/entries', authMiddleware);
app.use('/entries/*', authMiddleware);

app.get('/me', c => {
  const { ownerId, label } = c.get('auth');
  return c.json({
    ownerId,
    label,
    href: `mongo://${ownerId}`,
  });
});

app.get('/entries', async c => {
  const { ownerId } = c.get('auth');
  const userKey = c.req.query('userKey') || '';
  const mediaType = c.req.query('mediaType') as 'anime' | 'manga' | undefined;
  const statusRaw = c.req.query('status');
  const status = statusRaw !== undefined && statusRaw !== '' ? Number(statusRaw) : undefined;

  try {
    const db = await getDb();
    const rows = await listEntries(db, ownerId, { userKey, mediaType, status });
    return c.json({ rows });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post('/entries', async c => {
  const { ownerId } = c.get('auth');
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'invalid json' }, 400);

  try {
    const db = await getDb();
    const row = await upsertEntry(db, ownerId, body);
    return c.json({ row });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.delete('/entries/:entryId', async c => {
  const { ownerId } = c.get('auth');
  const entryId = decodeURIComponent(c.req.param('entryId'));
  const mediaType = c.req.query('mediaType') as 'anime' | 'manga' | undefined;
  const userKey = c.req.query('userKey') || '';

  if (!mediaType) return c.json({ error: 'mediaType is required' }, 400);

  try {
    const db = await getDb();
    const result = await deleteEntry(db, ownerId, { entryId, mediaType, userKey });
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post('/entries/link', async c => {
  const { ownerId } = c.get('auth');
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'invalid json' }, 400);

  try {
    const db = await getDb();
    await linkEntries(db, ownerId, body);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post('/entries/unlink', async c => {
  const { ownerId } = c.get('auth');
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'invalid json' }, 400);

  try {
    const db = await getDb();
    await unlinkEntries(db, ownerId, body);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

const port = Number(process.env.PORT) || 8787;
serve({ fetch: app.fetch, port }, info => {
  console.log(`[malsync-mongodb-backend] listening on http://localhost:${info.port}`);
});

export default app;
