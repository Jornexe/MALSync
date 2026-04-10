import { SenderError, t } from '../node_modules/spacetimedb/dist/server/index';
import spacetimedb from './schema';

export default spacetimedb;

function normalizeValue(value: string | null | undefined) {
	if (!value) return undefined;
	const trimmed = value.trim();
	return trimmed.length ? trimmed : undefined;
}

function normalizeUserKey(value: string | null | undefined) {
	if (!value) return undefined;
	const trimmed = value.trim().toLowerCase();
	return trimmed.length ? trimmed : undefined;
}

function normalizeAltTitles(value: string[] | null | undefined) {
	if (!Array.isArray(value)) return [];
	const dedupe = new Set<string>();
	for (const title of value) {
		if (!title) continue;
		const trimmed = title.trim();
		if (!trimmed) continue;
		dedupe.add(trimmed);
	}
	return [...dedupe];
}

export const upsert_entry = spacetimedb.reducer(
	{
		entryId: t.string(),
		mediaType: t.string(),
		userKey: t.string(),
		sourceUrl: t.string(),
		title: t.string(),
		altTitles: t.array(t.string()).optional(),
		image: t.string().optional(),
		tags: t.string(),
		streamingUrl: t.string().optional(),
		progress: t.u32(),
		volumeProgress: t.u32(),
		score: t.u8(),
		status: t.u8(),
	},
	(ctx, params) => {
		console.log('[SpaceTimeDB][Server] upsert_entry:start', {
			sender: ctx.sender.toHexString(),
			entryId: params.entryId,
			mediaType: params.mediaType,
			progress: params.progress,
			volumeProgress: params.volumeProgress,
			score: params.score,
			status: params.status,
		});

		if (!params.entryId) {
			throw new SenderError('entryId is required');
		}
		if (params.mediaType !== 'anime' && params.mediaType !== 'manga') {
			throw new SenderError('mediaType must be anime or manga');
		}

		const userKey = normalizeUserKey(params.userKey);
		if (!userKey) {
			throw new SenderError('userKey is required');
		}
		const id = `uk:${userKey}::${params.mediaType}::${params.entryId}`;

		const existing = ctx.db.syncEntry.id.find(id);

		const nextRow = {
			id,
			entryId: params.entryId,
			ownerId: ctx.sender,
			userKey,
			mediaType: params.mediaType,
			sourceUrl: params.sourceUrl,
			title: params.title,
			altTitles: normalizeAltTitles(params.altTitles),
			image: normalizeValue(params.image),
			tags: params.tags,
			streamingUrl: normalizeValue(params.streamingUrl),
			progress: params.progress,
			volumeProgress: params.volumeProgress,
			score: params.score,
			status: params.status,
			updatedAt: ctx.timestamp,
		};

		if (existing) {
			ctx.db.syncEntry.id.update({ ...existing, ...nextRow });
			console.log('[SpaceTimeDB][Server] upsert_entry:update', {
				id,
				entryId: params.entryId,
			});
			return;
		}

		ctx.db.syncEntry.insert(nextRow);
		console.log('[SpaceTimeDB][Server] upsert_entry:insert', {
			id,
			entryId: params.entryId,
		});
	},
);

export const delete_entry = spacetimedb.reducer(
	{
		entryId: t.string(),
		mediaType: t.string(),
		userKey: t.string(),
	},
	(ctx, { entryId, mediaType, userKey }) => {
		console.log('[SpaceTimeDB][Server] delete_entry:start', {
			sender: ctx.sender.toHexString(),
			entryId,
			mediaType,
			userKey: normalizeUserKey(userKey) || null,
		});

		if (mediaType !== 'anime' && mediaType !== 'manga') {
			throw new SenderError('mediaType must be anime or manga');
		}

		const normalizedUserKey = normalizeUserKey(userKey);
		if (!normalizedUserKey) {
			throw new SenderError('userKey is required');
		}

		const allRows = [...ctx.db.syncEntry.iter()];
		const existing = allRows.find(row => {
			if (row.entryId !== entryId || row.mediaType !== mediaType) return false;
			return row.userKey === normalizedUserKey;
		});

		if (!existing) {
			console.log('[SpaceTimeDB][Server] delete_entry:miss', { entryId, mediaType });
			return;
		}
		ctx.db.syncEntry.id.delete(existing.id);
		console.log('[SpaceTimeDB][Server] delete_entry:done', { id: existing.id, entryId, mediaType });
	},
);
