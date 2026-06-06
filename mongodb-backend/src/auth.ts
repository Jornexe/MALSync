import { createHash } from 'node:crypto';
import { MiddlewareHandler } from 'hono';
import { apiKeys, getDb } from './db.js';

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export type AuthContext = {
  ownerId: string;
  label: string;
};

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const provided = c.req.header('x-api-key') || '';
  const allowAnon = process.env.ALLOW_ANON === '1';

  if (!provided) {
    if (allowAnon) {
      c.set('auth', { ownerId: 'anonymous', label: 'anonymous' });
      return next();
    }
    return c.json({ error: 'missing X-API-Key' }, 401);
  }

  const db = await getDb();
  const row = await apiKeys(db).findOne({ keyHash: hashKey(provided) });
  if (!row) {
    return c.json({ error: 'invalid api key' }, 401);
  }

  c.set('auth', { ownerId: row.ownerId, label: row.label });
  return next();
};
