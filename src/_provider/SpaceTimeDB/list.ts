/* eslint-disable */
import { ListAbstract, listElement } from '../listAbstract';
import * as helper from './helper';
import * as definitions from '../definitions';

export class UserList extends ListAbstract {
  name = 'SpaceTimeDB';

  authenticationUrl = 'https://spacetimedb.com';

  async getUserObject() {
    return helper.getUserObject();
  }

  deauth() {
    return helper.clearSession();
  }

  _getSortingOptions() {
    return [];
  }

  async getPart() {
    con.log('[UserList][SpaceTimeDB]', `status: ${this.status}`);
    this.done = true;

    const data = await this.getSyncList();
    return this.prepareData(data, this.listType, this.status);
  }

  private async prepareData(data, listType, status): Promise<listElement[]> {
    const newData = [] as listElement[];

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
        newData.push(
          await this.fn(
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
              title: `[SDB] ${el.name}`,
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
        newData.push(
          await this.fn(
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
              title: `[SDB] ${el.name}`,
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

    return newData;
  }

  private getRegex = helper.getRegex;

  protected getSyncList = helper.getSyncList;

  protected getCacheKey = helper.getCacheKey;
}
