import { ListAbstract, listElement } from '../listAbstract';
import * as helper from './helper';
import * as definitions from '../definitions';

export class UserList extends ListAbstract {
  name = 'local';

  authenticationUrl = '';

  protected clientSortSupported = true;

  async getUserObject() {
    return Promise.resolve({ username: 'local', picture: '', href: '' });
  }

  _getSortingOptions() {
    return this.clientSortingOptions();
  }

  async getPart() {
    con.log('[UserList][Local]', `status: ${this.status}`);
    this.done = true;
    const syncList = await this.getSyncList();
    if (api.storage.primeReadCache) await api.storage.primeReadCache();
    try {
      return await this.prepareData(syncList, this.listType, this.status);
    } finally {
      api.storage.clearReadCache?.();
    }
  }

  private async prepareData(data, listType, status): Promise<listElement[]> {
    const tasks = [] as Promise<listElement>[];
    for (const key in data) {
      if (this.getRegex(listType).test(key)) {
        const el = data[key];
        if (status !== definitions.status.All && parseInt(el.status) !== status) {
          continue;
        }
        if (listType === 'anime') {
          tasks.push(
            this.fn(
              {
                uid: key,
                cacheKey: this.getCacheKey(utils.urlPart(key, 4), utils.urlPart(key, 2)),
                type: 'anime',
                airingState: 2,
                image: el.image ?? '',
                imageLarge: el.image ?? '',
                malId: 0,
                apiCacheKey: 0,
                tags: el.tags,
                title: `[L] ${el.name}`,
                url: key,
                score: el.score,
                watchedEp: el.progress,
                totalEp: 0,
                status: el.status,
              },
              el.sUrl,
            ),
          );
        } else {
          tasks.push(
            this.fn(
              {
                uid: key,
                cacheKey: this.getCacheKey(utils.urlPart(key, 4), utils.urlPart(key, 2)),
                type: 'manga',
                airingState: 2,
                image: el.image ?? '',
                imageLarge: el.image ?? '',
                malId: 0,
                apiCacheKey: 0,
                tags: el.tags,
                title: `[L] ${el.name}`,
                url: key,
                score: el.score,
                watchedEp: el.progress,
                readVol: el.volumeprogress,
                totalEp: 0,
                totalVol: 0,
                status: el.status,
              },
              el.sUrl,
            ),
          );
        }
      }
    }

    return Promise.all(tasks);
  }

  private getRegex = helper.getRegex;

  protected getSyncList = helper.getSyncList;

  protected getCacheKey = helper.getCacheKey;
}
