import { SenderError, t } from '../node_modules/spacetimedb/dist/server/index';
import spacetimedb from './schema';

export default spacetimedb;

function normalizeValue(value: string | null | undefined) {
	if (!value) return undefined;
	const trimmed = value.trim();
	return trimmed.length ? trimmed : undefined;
}

export const upsert_entry = spacetimedb.reducer(
	{
		entryId: t.string(),
		mediaType: t.string(),
		sourceUrl: t.string(),
		title: t.string(),
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

		const id = `${ctx.sender.toHexString()}::${params.entryId}`;
		const existing = ctx.db.syncEntry.id.find(id);

		const nextRow = {
			id,
			entryId: params.entryId,
			ownerId: ctx.sender,
			mediaType: params.mediaType,
			sourceUrl: params.sourceUrl,
			title: params.title,
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
	},
	(ctx, { entryId }) => {
		console.log('[SpaceTimeDB][Server] delete_entry:start', {
			sender: ctx.sender.toHexString(),
			entryId,
		});

		const id = `${ctx.sender.toHexString()}::${entryId}`;
		const existing = ctx.db.syncEntry.id.find(id);
		if (!existing) {
			console.log('[SpaceTimeDB][Server] delete_entry:miss', { id, entryId });
			return;
		}
		ctx.db.syncEntry.id.delete(id);
		console.log('[SpaceTimeDB][Server] delete_entry:done', { id, entryId });
	},
);
