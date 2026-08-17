import Fuse from 'fuse.js';

import { listElement } from '../listAbstract';
import { UserList as LocalList } from './list';
import { searchResult } from '../definitions';
import { normalSearch } from '../../utils/Search';
import { getSyncMode } from '../helper';
import { getOnlyList } from '../listFactory';

const searchFuse: {
  anime: null | Fuse<listElement>;
  manga: null | Fuse<listElement>;
} = {
  anime: null,
  manga: null,
};

// The library lives in different places depending on the sync mode. For the
// storage-only providers (MongoDB/SpaceTimeDB) the user's entries exist only in
// that provider, so the search index must come from there — otherwise searching
// returns zero of the user's tracked entries. Other modes keep using the Local
// cache (their list is searchable remotely via normalSearch).
async function getSearchList(type: 'anime' | 'manga'): Promise<listElement[]> {
  const syncMode = getSyncMode(type);
  if (syncMode === 'MONGODB' || syncMode === 'SPACETIMEDB') {
    return getOnlyList(7, type).getCompleteList();
  }
  return new LocalList(7, type).getCompleteList();
}

export async function search(searchterm: string, type: 'anime' | 'manga'): Promise<searchResult[]> {
  if (!searchFuse[type]) {
    const tempList = await getSearchList(type);
    searchFuse[type] = new Fuse(tempList, {
      minMatchCharLength: 3,
      threshold: 0.4,
      keys: [
        { name: 'title', weight: 0.7 },
        { name: 'altTitles', weight: 0.3 },
      ],
    });
  }

  const results = searchFuse[type].search(searchterm);

  return results.map(el => {
    return {
      id: 0,
      name: el.item.title,
      altNames: el.item.altTitles || [],
      url: el.item.url,
      malUrl: () => Promise.resolve(null),
      image: el.item.image,
      imageLarge: el.item.image,
      media_type: el.item.type,
      isNovel: false,
      score: '',
      year: '',
      list: {
        status: el.item.status,
        score: el.item.score,
        episode: el.item.watchedEp,
      },
    };
  });
}

export async function miniMALSearch(searchterm: string, type: 'anime' | 'manga') {
  return [
    ...(await search(searchterm, type)).slice(0, 8),
    ...(await normalSearch(searchterm, type)),
  ];
}
