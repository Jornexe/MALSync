/* eslint-disable */
import { ListAbstract, listElement } from '../listAbstract';
import * as helper from './helper';
import * as definitions from '../definitions';

export class UserList extends ListAbstract {
  name = 'SpaceTimeDB';

  authenticationUrl = 'https://spacetimedb.com';

  protected clientSortSupported = true;

  async getUserObject() {
    return helper.getUserObject();
  }

  deauth() {
    return helper.clearSession();
  }

  _getSortingOptions() {
    return this.clientSortingOptions();
  }

  async getPart() {
    con.log('[UserList][SpaceTimeDB]', `status: ${this.status}`);
    this.done = true;

    const data = await this.getSyncList();
    if (api.storage.primeReadCache) await api.storage.primeReadCache();
    try {
      return await this.prepareData(data, this.listType, this.status);
    } finally {
      api.storage.clearReadCache?.();
    }
  }

  private async prepareData(data, listType, status): Promise<listElement[]> {
    const tasks = [] as Promise<listElement>[];

    for (const key in data) {
      if (!this.getRegex(listType).test(key)) {
        continue;
      }

      const el = data[key];
      if (status !== definitions.status.All && parseInt(el.status, 10) !== status) {
        continue;
      }

      const sourceUrl = el.sourceUrl || `local://spacetimedb/${listType}/${encodeURIComponent(el.name)}`;

      if (listType === 'anime') {
        tasks.push(
          this.fn(
            {
              uid: key,
              cacheKey: this.getCacheKey(decodeURIComponent(utils.urlPart(key, 3)), 'anime'),
              type: 'anime',
              airingState: 2,
              image: el.image ?? '',
              imageLarge: el.image ?? '',
              malId: 0,
              apiCacheKey: 0,
              tags: el.tags,
              title: el.name,
              altTitles: Array.isArray(el.altTitles) ? el.altTitles : [],
              url: sourceUrl,
              score: Number(el.score) || 0,
              watchedEp: Number(el.progress) || 0,
              totalEp: 0,
              status: Number(el.status) || definitions.status.PlanToWatch,
              startDate: null,
              finishDate: null,
              rewatchCount: 0,
            },
            el.sUrl,
          ),
        );
      } else {
        tasks.push(
          this.fn(
            {
              uid: key,
              cacheKey: this.getCacheKey(decodeURIComponent(utils.urlPart(key, 3)), 'manga'),
              type: 'manga',
              airingState: 2,
              image: el.image ?? '',
              imageLarge: el.image ?? '',
              malId: 0,
              apiCacheKey: 0,
              tags: el.tags,
              title: el.name,
              altTitles: Array.isArray(el.altTitles) ? el.altTitles : [],
              url: sourceUrl,
              score: Number(el.score) || 0,
              watchedEp: Number(el.progress) || 0,
              readVol: Number(el.volumeprogress) || 0,
              totalEp: 0,
              totalVol: 0,
              status: Number(el.status) || definitions.status.PlanToWatch,
              startDate: null,
              finishDate: null,
              rewatchCount: 0,
            },
            el.sUrl,
          ),
        );
      }
    }

    return Promise.all(tasks);
  }

  private getRegex = helper.getRegex;

  protected getSyncList = helper.getSyncList;

  protected getCacheKey = helper.getCacheKey;
}
