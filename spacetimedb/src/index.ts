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

function normalizeAliases(value: string[] | null | undefined) {
	if (!Array.isArray(value)) return [];
	const dedupe = new Set<string>();
	for (const alias of value) {
		if (!alias) continue;
		const trimmed = alias.trim();
		if (!trimmed) continue;
		dedupe.add(trimmed);
	}
	return [...dedupe];
}

function normalizeTitleKey(value: string | null | undefined) {
	if (!value) return '';
	return value
		.toLowerCase()
		.trim()
		.replace(/[\W_]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function hasStrongTitleContainment(a: string, b: string) {
	if (!a || !b) return false;
	const shorter = a.length <= b.length ? a : b;
	const longer = a.length <= b.length ? b : a;

	// Guard against generic matches like "the" or "one piece" fragments.
	if (shorter.length < 10) return false;

	return longer.includes(shorter);
}

function hasTitleMatch(rowKey: string, nextKey: string, mode: 'exact' | 'fuzzy') {
	if (mode === 'exact') return rowKey === nextKey;
	return rowKey === nextKey || hasStrongTitleContainment(rowKey, nextKey);
}

function mergeAltTitles(current: string[], incoming: string[]) {
	const dedupe = new Set<string>();
	for (const title of current) {
		if (!title) continue;
		dedupe.add(title);
	}
	for (const title of incoming) {
		if (!title) continue;
		dedupe.add(title);
	}
	return [...dedupe];
}

function hasTitleOverlap(
	rowTitle: string,
	rowAltTitles: string[],
	nextTitle: string,
	nextAltTitles: string[],
	mode: 'off' | 'exact' | 'fuzzy',
) {
	if (mode === 'off') return false;

	const rowTitleKeys = new Set<string>([normalizeTitleKey(rowTitle), ...rowAltTitles.map(normalizeTitleKey)].filter(Boolean));
	const nextTitleKeys = [normalizeTitleKey(nextTitle), ...nextAltTitles.map(normalizeTitleKey)].filter(Boolean);

	for (const rowKey of rowTitleKeys) {
		for (const nextKey of nextTitleKeys) {
			if (hasTitleMatch(rowKey, nextKey, mode)) return true;
		}
	}

	return false;
}

function preferString(current: string, incoming: string | undefined) {
	if (incoming && incoming.trim()) return incoming;
	return current;
}

export const upsert_entry = spacetimedb.reducer(
	{
		entryId: t.string(),
		mediaType: t.string(),
		userKey: t.string(),
		titleMergeMode: t.string().optional(),
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
		const titleMergeMode =
			params.titleMergeMode === 'off' ||
			params.titleMergeMode === 'exact' ||
			params.titleMergeMode === 'fuzzy'
				? params.titleMergeMode
				: 'fuzzy';

		console.log('[SpaceTimeDB][Server] upsert_entry:start', {
			sender: ctx.sender.toHexString(),
			entryId: params.entryId,
			mediaType: params.mediaType,
			titleMergeMode,
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
		const ownerRows = [...ctx.db.syncEntry.iter()].filter(
			row => row.userKey === userKey && row.mediaType === params.mediaType,
		);

		let existing = ownerRows.find(
			row => row.entryId === params.entryId || normalizeAliases(row.aliases).includes(params.entryId),
		);
		let resolvedBy: 'id-or-alias' | 'title' | 'none' = existing ? 'id-or-alias' : 'none';

		const nextAltTitles = normalizeAltTitles(params.altTitles);
		if (!existing) {
			existing = ownerRows.find(row =>
				hasTitleOverlap(row.title, row.altTitles, params.title, nextAltTitles, titleMergeMode),
			);
			if (existing) resolvedBy = 'title';
		}

		const id = existing ? existing.id : `uk:${userKey}::${params.mediaType}::${params.entryId}`;

		const isTitleFallbackLink = existing && resolvedBy === 'title';
		const aliases = normalizeAliases([
			...(existing?.aliases || []),
			existing?.entryId || params.entryId,
			params.entryId,
		]);

		const nextRow = {
			id,
			entryId: existing?.entryId || params.entryId,
			ownerId: ctx.sender,
			userKey,
			mediaType: params.mediaType,
			sourceUrl: isTitleFallbackLink
				? preferString(existing?.sourceUrl || '', normalizeValue(params.sourceUrl))
				: params.sourceUrl,
			title: isTitleFallbackLink ? preferString(existing?.title || '', params.title) : params.title,
			altTitles: mergeAltTitles(existing?.altTitles || [], nextAltTitles),
			image: isTitleFallbackLink
				? normalizeValue(existing?.image) || normalizeValue(params.image)
				: normalizeValue(params.image),
			tags: isTitleFallbackLink
				? preferString(existing?.tags || '', normalizeValue(params.tags))
				: params.tags,
			streamingUrl: isTitleFallbackLink
				? normalizeValue(existing?.streamingUrl) || normalizeValue(params.streamingUrl)
				: normalizeValue(params.streamingUrl),
			progress: isTitleFallbackLink ? Math.max(existing?.progress || 0, params.progress) : params.progress,
			volumeProgress: isTitleFallbackLink
				? Math.max(existing?.volumeProgress || 0, params.volumeProgress)
				: params.volumeProgress,
			score: isTitleFallbackLink ? (params.score ? params.score : existing?.score || 0) : params.score,
			status: isTitleFallbackLink ? existing?.status || params.status : params.status,
			updatedAt: ctx.timestamp,
			aliases,
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
			if (row.mediaType !== mediaType || row.userKey !== normalizedUserKey) return false;
			if (row.entryId === entryId) return true;
			return normalizeAliases(row.aliases).includes(entryId);
		});

		if (!existing) {
			console.log('[SpaceTimeDB][Server] delete_entry:miss', { entryId, mediaType });
			return;
		}

		ctx.db.syncEntry.id.delete(existing.id);
		console.log('[SpaceTimeDB][Server] delete_entry:done', { id: existing.id, entryId, mediaType });
	},
);
