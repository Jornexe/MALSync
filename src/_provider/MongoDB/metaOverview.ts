import { MetaOverviewAbstract } from '../metaOverviewAbstract';
import * as helper from './helper';

export class MetaOverview extends MetaOverviewAbstract {
  constructor(url: string) {
    super(url);
    this.logger = this.logger.m('MongoDB');
    if (url.match(/^mongo:\/\/(anime|manga)\//i)) {
      this.type = utils.urlPart(url, 2) === 'anime' ? 'anime' : 'manga';
      this.entryId = decodeURIComponent(utils.urlPart(url, 3) || '');
      return this;
    }
    this.type = 'anime';
    this.entryId = '';
  }

  protected readonly type: 'anime' | 'manga';

  private readonly entryId: string;

  // Build the overview from the entry's own stored metadata (inherited from an
  // external source like AniList). No network beyond the entry read, and a
  // missing field simply renders nothing.
  async _init() {
    if (!this.entryId) return this;

    const titleHint = decodeURIComponent(utils.urlPart(this.url, 4) || '').trim();

    let entry;
    try {
      entry = await helper.getEntry(this.entryId, this.type, titleHint);
    } catch (e) {
      this.logger.error('overview lookup failed', e);
      return this;
    }
    if (!entry) return this;

    if (entry.name) this.meta.title = entry.name;
    if (entry.description) this.meta.description = entry.description;
    if (entry.image) {
      this.meta.image = entry.image;
      this.meta.imageLarge = entry.image;
    }

    const altTitles = (entry.altTitles || []).filter(Boolean);
    if (altTitles.length) this.meta.alternativeTitle = altTitles;

    if (entry.communityScore) {
      this.meta.statistics.push({
        title: api.storage.lang('overview_sidebar_Score'),
        body: String(entry.communityScore),
      });
    }

    if (entry.year) {
      this.meta.info.push({ title: 'Year', body: [{ text: String(entry.year) }] });
    }

    if (this.type === 'anime' && entry.totalEp) {
      this.meta.info.push({
        title: api.storage.lang('overview_sidebar_Episodes'),
        body: [{ text: String(entry.totalEp) }],
      });
    }
    if (this.type === 'manga' && entry.totalVol) {
      this.meta.info.push({ title: 'Volumes', body: [{ text: String(entry.totalVol) }] });
    }

    const genres = (entry.genres || []).filter(Boolean);
    if (genres.length) {
      this.meta.info.push({ title: 'Genres', body: genres.map(genre => ({ text: genre })) });
    }

    this.logger.log('overview', this.meta);
    return this;
  }
}
