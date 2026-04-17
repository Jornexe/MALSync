import { MetaOverviewAbstract } from '../metaOverviewAbstract';

export class MetaOverview extends MetaOverviewAbstract {
  constructor(url: string) {
    super(url);
    this.logger = this.logger.m('SpaceTimeDB');
    if (url.match(/^stdb:\/\/(anime|manga)\//i)) {
      this.type = utils.urlPart(url, 2) === 'anime' ? 'anime' : 'manga';
      return this;
    }
    // Fallback: treat as local-style URL
    this.type = 'anime';
  }

  protected readonly type: 'anime' | 'manga';

  async _init() {
    return this;
  }
}
