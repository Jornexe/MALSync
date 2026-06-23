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
  // card (title-less key) — share one cached overview. Short TTL so freshly
  // inherited data shows up quickly; the heavy live fetch is cached separately.
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

    // Stored data first: build the overview from what the entry owns.
    this.applyStored(entry);

    // Then fill the gaps from the canonical source (recommendations, related,
    // reviews, banner, and any field the entry doesn't store).
    const canonicalUrl = this.canonicalUrlFromAliases(entry.aliases || []);
    if (canonicalUrl) {
      try {
        const live = (await new AniListMeta(canonicalUrl).init()).getMeta();
        this.fillGaps(live);
      } catch (e) {
        this.logger.error('live gap-fill failed', e);
      }
    }

    return this;
  }

  private applyStored(entry) {
    const lang = api.storage.lang;

    if (entry.name) this.meta.title = entry.name;
    if (entry.description) this.meta.description = entry.description;
    if (entry.image) {
      this.meta.image = entry.image;
      this.meta.imageLarge = entry.image;
    }

    const altTitles = (entry.altTitles || []).filter(Boolean);
    if (altTitles.length) this.meta.alternativeTitle = altTitles;

    const characters = (entry.characters || []).filter(character => character && character.name);
    if (characters.length) this.meta.characters = characters;

    if (entry.communityScore) {
      this.meta.statistics.push({
        title: lang('overview_sidebar_Score'),
        body: String(entry.communityScore),
      });
    }

    const pushInfo = (key: string, text: string | number) => {
      if (text) this.meta.info.push({ title: lang(key), body: [{ text: String(text) }] });
    };
    pushInfo('overview_sidebar_Format', entry.format);
    pushInfo('overview_sidebar_Status', entry.airStatus);
    pushInfo('overview_sidebar_Season', entry.season);
    if (entry.duration) {
      this.meta.info.push({
        title: lang('overview_sidebar_Duration'),
        body: [{ text: `${entry.duration} min` }],
      });
    }
    if (this.type === 'anime' && entry.totalEp) {
      pushInfo('overview_sidebar_Episodes', entry.totalEp);
    }
    if (this.type === 'manga' && entry.totalVol) {
      pushInfo('overview_sidebar_Volumes', entry.totalVol);
    }
    if (!entry.season && entry.year) {
      pushInfo('overview_sidebar_Premiered', entry.year);
    }

    const genres = (entry.genres || []).filter(Boolean);
    if (genres.length) {
      this.meta.info.push({
        title: lang('overview_sidebar_Genres'),
        body: genres.map(genre => ({ text: genre })),
      });
    }
    const studios = (entry.studios || []).filter(Boolean);
    if (studios.length) {
      this.meta.info.push({
        title: lang('overview_sidebar_Studios'),
        body: studios.map(studio => ({ text: studio })),
      });
    }
  }

  private fillGaps(live) {
    if (!this.meta.title && live.title) this.meta.title = live.title;
    if (!this.meta.description && live.description) this.meta.description = live.description;
    if (!this.meta.image && live.image) this.meta.image = live.image;
    if (!this.meta.imageLarge && live.imageLarge) this.meta.imageLarge = live.imageLarge;
    if (live.imageBanner) this.meta.imageBanner = live.imageBanner;

    if (!this.meta.alternativeTitle.length && live.alternativeTitle?.length) {
      this.meta.alternativeTitle = live.alternativeTitle;
    }
    if (!this.meta.characters.length && live.characters?.length) {
      this.meta.characters = live.characters;
    }

    // Append live entries the stored data doesn't already cover (matched by title).
    const statTitles = new Set(this.meta.statistics.map(stat => stat.title.toLowerCase()));
    (live.statistics || []).forEach(stat => {
      if (!statTitles.has(stat.title.toLowerCase())) this.meta.statistics.push(stat);
    });
    const infoTitles = new Set(this.meta.info.map(info => info.title.toLowerCase()));
    (live.info || []).forEach(info => {
      if (!infoTitles.has(info.title.toLowerCase())) this.meta.info.push(info);
    });

    // Sections the entry never stores always come from live.
    if (live.related?.length) this.meta.related = live.related;
    if (live.reviews?.length) this.meta.reviews = live.reviews;
    if (live.recommendations?.length) this.meta.recommendations = live.recommendations;
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
