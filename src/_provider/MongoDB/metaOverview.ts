import { MetaOverviewAbstract } from '../metaOverviewAbstract';
import { MetaOverview as AniListMeta } from '../AniList/metaOverview';
import { Cache } from '../../utils/Cache';
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

  // Key the cache by entryId (not the full url), so the two ways an entry is
  // opened — the in-page float button (url carries the title) and the library
  // card (title-less key) — share one cached overview. Short TTL so a freshly
  // inherited source shows up almost immediately; the heavy AniList fetch is
  // still cached separately under its own url.
  getCache() {
    if (this.cacheObj) return this.cacheObj;
    this.cacheObj = new Cache(`mongoMeta/${this.type}/${this.entryId}`, 10 * 1000);
    return this.cacheObj;
  }

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

    // Preferred path: the entry carries a canonical tracker id (added when its
    // metadata was inherited), so render the full external overview — characters,
    // recommendations, related, statistics and all sidebar info — instead of the
    // handful of fields stored locally. AniList's overview also parses MAL urls.
    const canonicalUrl = this.canonicalUrlFromAliases(entry.aliases || []);
    if (canonicalUrl) {
      try {
        const ov = await new AniListMeta(canonicalUrl).init();
        this.meta = ov.getMeta();
        this.logger.log('overview via canonical source', { canonicalUrl });
        return this;
      } catch (e) {
        this.logger.error('canonical overview failed, falling back to stored fields', e);
      }
    }

    // Fallback: no canonical link, so build a minimal overview from the fields
    // stored on the entry itself.
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

    return this;
  }

  private canonicalUrlFromAliases(aliases: string[]): string {
    // Prefer AniList (richest overview), fall back to a MAL id.
    const ani = aliases.find(alias => /^anilist:\d+$/i.test(alias));
    if (ani) return `https://anilist.co/${this.type}/${ani.split(':')[1]}`;
    const mal = aliases.find(alias => /^mal:\d+$/i.test(alias));
    if (mal) return `https://myanimelist.net/${this.type}/${mal.split(':')[1]}`;
    return '';
  }
}
