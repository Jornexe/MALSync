import { urlToSlug } from '../utils/slugs';
import * as helper from './helper';
import { Cache } from '../utils/Cache';

import { Single as MalSingle } from './MyAnimeList_hybrid/single';
import { Single as MalApiSingle } from './MyAnimeList_api/single';
import { Single as AnilistSingle } from './AniList/single';
import { Single as KitsuSingle } from './Kitsu/single';
import { Single as MangaBakaSingle } from './MangaBaka/single';
import { Single as SimklSingle } from './Simkl/single';
import { Single as ShikiSingle } from './Shikimori/single';
import { Single as LocalSingle } from './Local/single';
import { Single as SpaceTimeDbSingle } from './SpaceTimeDB/single';

export function getSingle(url: string) {
  if (/^local:\/\//i.test(url)) {
    const localType = utils.urlPart(url, 3) as 'anime' | 'manga';
    const localEntryId = decodeURIComponent(utils.urlPart(url, 4) || '');
    const localSyncMode = helper.getSyncMode(localType);

    con.log('[SingleFactory]', 'local-url', {
      url,
      localType,
      localEntryId,
      resolvedSyncMode: localSyncMode,
    });

    if (localType && localEntryId && localSyncMode === 'SPACETIMEDB') {
      return new SpaceTimeDbSingle(url);
    }

    return new LocalSingle(url);
  }
  if (/^stdb:\/\//i.test(url)) {
    return new SpaceTimeDbSingle(url);
  }

  const slug = urlToSlug(url);
  if (!slug.path) {
    throw new Error(`URL not supported: ${url}`);
  }

  const syncMode = helper.getSyncMode(slug.path.type);
  if (syncMode === 'MAL') {
    return new MalSingle(url);
  }
  if (syncMode === 'MALAPI') {
    return new MalApiSingle(url);
  }
  if (syncMode === 'ANILIST') {
    return new AnilistSingle(url);
  }
  if (syncMode === 'KITSU') {
    return new KitsuSingle(url);
  }
  if (syncMode === 'MANGABAKA') {
    return new MangaBakaSingle(url);
  }
  if (syncMode === 'SIMKL') {
    return new SimklSingle(url);
  }
  if (syncMode === 'SHIKI') {
    return new ShikiSingle(url);
  }
  if (syncMode === 'SPACETIMEDB') {
    return new SpaceTimeDbSingle(url);
  }
  throw 'Unknown sync mode';
}

export async function getRulesCacheKey(
  url: string,
): Promise<{ rulesCacheKey: string | number; singleObj? }> {
  const cacheObj = new Cache(`rulesCacheKey/${url}`, 7 * 24 * 60 * 60 * 1000);

  if (await cacheObj.hasValue()) {
    return cacheObj.getValue().then(res => {
      return {
        rulesCacheKey: res,
      };
    });
  }

  const singleObj = getSingle(url);
  await singleObj.update();
  cacheObj.setValue(singleObj.getRulesCacheKey());
  return {
    rulesCacheKey: singleObj.getRulesCacheKey(),
    singleObj,
  };
}
