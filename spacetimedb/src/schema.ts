import { schema, table, t } from '../node_modules/spacetimedb/dist/server/index';

export const SyncEntry = table(
	{
		name: 'sync_entry',
		public: true,
		indexes: [
			{
				accessor: 'sync_entry_owner_id',
				name: 'sync_entry_owner_id',
				algorithm: 'btree',
				columns: ['ownerId'],
			},
			{
				accessor: 'sync_entry_user_key',
				name: 'sync_entry_user_key',
				algorithm: 'btree',
				columns: ['userKey'],
			},
			{
				accessor: 'sync_entry_entry_id',
				name: 'sync_entry_entry_id',
				algorithm: 'btree',
				columns: ['entryId'],
			},
		],
	},
	{
		id: t.string().primaryKey(),
		entryId: t.string(),
		ownerId: t.identity(),
		userKey: t.string(),
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
		updatedAt: t.timestamp(),
	},
);

export default schema({ syncEntry: SyncEntry });
