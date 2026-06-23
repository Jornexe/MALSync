/* eslint-disable */
import { ListAbstract, listElement } from '../listAbstract';
import * as helper from './helper';
import * as definitions from '../definitions';

export class UserList extends ListAbstract {
  name = 'MongoDB';

  authenticationUrl = 'https://www.mongodb.com';

  protected clientSortSupported = true;

  async getUserObject() {
    return helper.getUserObject();
  }

  deauth() {
    return helper.clearSession();
  }

  _getSortingOptions() {
    // MongoDB persists updatedAt per entry, so it can offer "Last updated" on
    // top of the shared title/score/progress sorts.
    return [
      ...this.clientSortingOptions(),
      {
        icon: 'history',
        title: api.storage.lang('list_sorting_history'),
        value: 'updated',
        asc: true,
      },
    ];
  }

  async getPart() {
    con.log('[UserList][MongoDB]', `status: ${this.status}`);
    this.done = true;

    const data = await this.getSyncList(
      this.listType,
      this.status === definitions.status.All ? undefined : this.status,
    );
    // Decorating 1k+ entries reads several storage keys each; prime a single
    // bulk snapshot so those become in-memory lookups instead of one IPC apiece.
    if (api.storage.primeReadCache) await api.storage.primeReadCache();
    try {
      return await this.prepareData(data, this.listType, this.status);
    } finally {
      api.storage.clearReadCache?.();
    }
  }

  private async prepareData(data, listType, status): Promise<listElement[]> {
    // Build every entry's item function concurrently. Each fn() performs a few
    // independent storage reads (tag settings, continue/resume URLs, progress);
    // awaiting them one entry at a time turns a 1k+ library into thousands of
    // serial round-trips, which is the main driver of overview load time.
    const tasks = [] as Promise<listElement>[];

    for (const key in data) {
      if (!this.getRegex(listType).test(key)) {
        continue;
      }

      const el = data[key];
      if (status !== definitions.status.All && parseInt(el.status, 10) !== status) {
        continue;
      }

      const sourceUrl = el.sourceUrl || `local://mongodb/${listType}/${encodeURIComponent(el.name)}`;

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
              updatedAt: el.updatedAt || 0,
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
              updatedAt: el.updatedAt || 0,
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
