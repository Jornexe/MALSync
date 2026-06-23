import { SingleAbstract } from '../singleAbstract';
import { UrlNotSupportedError } from '../Errors';
import * as definitions from '../definitions';
import * as helper from './helper';
import { pathToUrl, urlToSlug } from '../../utils/slugs';

function normalizeAltTitles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const dedupe = new Set<string>();
  value.forEach(el => {
    if (typeof el !== 'string') return;
    const trimmed = el.trim();
    if (!trimmed) return;
    dedupe.add(trimmed);
  });
  return [...dedupe];
}

function normalizeAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const dedupe = new Set<string>();
  value.forEach(el => {
    if (typeof el !== 'string') return;
    const trimmed = el.trim();
    if (!trimmed) return;
    dedupe.add(trimmed);
  });
  return [...dedupe];
}

export class Single extends SingleAbstract {
  constructor(protected url: string) {
    super(url);
    this.logger = con.m(this.shortName, '#13aa52');
    this.animeInfo = {};
    return this;
  }

  private animeInfo: any;

  protected key!: string;

  protected entryId!: string;

  shortName = 'MongoDB';

  authenticationUrl = 'https://www.mongodb.com';

  protected rewatchingSupport = false;

  protected datesSupport = false;

  protected handleUrl(url) {
    if (url.match(/^mongo:\/\/(anime|manga)\/.*/i)) {
      this.type = utils.urlPart(url, 2) === 'anime' ? 'anime' : 'manga';
      this.entryId = decodeURIComponent(utils.urlPart(url, 3));
      this.key = `mongo://${this.type}/${encodeURIComponent(this.entryId)}`;
      return;
    }

    if (url.match(/^local:\/\/[^/]+\/(anime|manga)\/[^/]+/i)) {
      this.type = utils.urlPart(url, 3) === 'anime' ? 'anime' : 'manga';
      this.entryId = decodeURIComponent(utils.urlPart(url, 4));
      this.key = `mongo://${this.type}/${encodeURIComponent(this.entryId)}`;
      return;
    }

    const slugObj = urlToSlug(url);
    if (!slugObj.path) {
      throw new UrlNotSupportedError(url);
    }

    this.type = slugObj.path.type;
    this.entryId = slugObj.path.slug;
    this.key = `mongo://${this.type}/${encodeURIComponent(this.entryId)}`;
  }

  getCacheKey() {
    return helper.getCacheKey(this.entryId, this.getType()!);
  }

  getPageId() {
    return this.entryId;
  }

  _getStatus() {
    return this.animeInfo.status;
  }

  _setStatus(status) {
    if (status === definitions.status.Rewatching && !this.supportsRewatching()) {
      status = definitions.status.Watching;
    }
    if (status === definitions.status.Considering && !this.supportsConsidering()) {
      status = definitions.status.PlanToWatch;
    }
    this.animeInfo.status = status;
  }

  _getStartDate(): never {
    throw new Error('MongoDB sync does not support Start Date');
  }

  _setStartDate(startDate) {
    throw new Error('MongoDB sync does not support Start Date');
  }

  _getFinishDate(): never {
    throw new Error('MongoDB sync does not support Finish Date');
  }

  _setFinishDate(finishDate) {
    throw new Error('MongoDB sync does not support Finish Date');
  }

  _getRewatchCount(): never {
    throw new Error('MongoDB sync does not support Rewatch Count');
  }

  _setRewatchCount(rewatchCount) {
    throw new Error('MongoDB sync does not support Rewatch Count');
  }

  _getScore() {
    return this.animeInfo.score;
  }

  _setScore(score) {
    this.animeInfo.score = score;
  }

  _getAbsoluteScore() {
    return this.getScore() * 10;
  }

  _setAbsoluteScore(score) {
    if (!score) {
      this.setScore(0);
      return;
    }
    if (score < 10) {
      this.setScore(1);
      return;
    }

    this.setScore(Math.round(score / 10));
  }

  _getEpisode() {
    return this.animeInfo.progress;
  }

  _setEpisode(episode) {
    this.animeInfo.progress = parseInt(`${episode}`, 10);
  }

  _getVolume() {
    return this.animeInfo.volumeprogress;
  }

  _setVolume(volume) {
    this.animeInfo.volumeprogress = volume;
  }

  _getTags() {
    let { tags } = this.animeInfo;
    if (!tags) tags = '';
    return tags;
  }

  _setTags(tags) {
    this.animeInfo.tags = tags;
  }

  _getTitle(raw = false) {
    return this.animeInfo.name;
  }

  _getTotalEpisodes() {
    return Number(this.animeInfo?.totalEp) || 0;
  }

  _getTotalVolumes() {
    return Number(this.animeInfo?.totalVol) || 0;
  }

  // Rich metadata inherited from an external source, surfaced for the overview.
  getDescription(): string {
    return this.animeInfo?.description || '';
  }

  getGenres(): string[] {
    return normalizeAltTitles(this.animeInfo?.genres);
  }

  getYear(): number {
    return Number(this.animeInfo?.year) || 0;
  }

  getCommunityScore(): number {
    return Number(this.animeInfo?.communityScore) || 0;
  }

  getFormat(): string {
    return this.animeInfo?.format || '';
  }

  getAirStatus(): string {
    return this.animeInfo?.airStatus || '';
  }

  getSeason(): string {
    return this.animeInfo?.season || '';
  }

  getDuration(): number {
    return Number(this.animeInfo?.duration) || 0;
  }

  getStudios(): string[] {
    return normalizeAltTitles(this.animeInfo?.studios);
  }

  getCharacters(): { name: string; img: string; url: string; subtext: string }[] {
    return Array.isArray(this.animeInfo?.characters) ? this.animeInfo.characters : [];
  }

  _getDisplayUrl() {
    if (this.animeInfo?.sourceUrl) return this.animeInfo.sourceUrl;

    try {
      if (this.getType() && this.entryId) {
        return pathToUrl({ type: this.getType()!, slug: this.entryId });
      }
    } catch (e) {
      // Ignore invalid path state during transient load errors.
    }

    return 'https://www.mongodb.com';
  }

  private getTitleFromUrl() {
    if (this.url.match(/^mongo:\/\//i)) {
      return decodeURIComponent(utils.urlPart(this.url, 4) || '').trim();
    }
    if (this.url.match(/^local:\/\//i)) {
      return decodeURIComponent(utils.urlPart(this.url, 5) || '').trim();
    }
    return '';
  }

  _getImage() {
    if (this.animeInfo && this.animeInfo.image) return this.animeInfo.image;
    return '';
  }

  setImage(url: string) {
    const hasImage = Boolean(this.animeInfo.image);
    this.animeInfo.image = url;
    if (this._onList && !hasImage) this.sync();
  }

  _getRating() {
    return Promise.resolve('MongoDB');
  }

  async _update() {
    this.logger.log('[MongoDB]', 'update:start', {
      entryId: this.entryId,
      type: this.getType(),
    });

    this._authenticated = true;
    this.animeInfo = await helper.getEntry(this.entryId, this.getType()!, this.getTitleFromUrl());

    this._onList = true;

    if (!this.animeInfo) {
      this._onList = false;
      const titleFromUrl = this.getTitleFromUrl();
      const localInfo =
        /^local:\/\//i.test(this.url) && api.storage ? await api.storage.get(this.url) : null;

      this.animeInfo = {
        name: (localInfo && localInfo.name) || titleFromUrl || this.entryId,
        aliases: [this.entryId],
        altTitles: [],
        tags: (localInfo && localInfo.tags) || '',
        sUrl: (localInfo && localInfo.sUrl) || '',
        image: (localInfo && localInfo.image) || '',
        sourceUrl: this.url,
        progress: Number((localInfo && localInfo.progress) || 0),
        volumeprogress: Number((localInfo && localInfo.volumeprogress) || 0),
        score: Number((localInfo && localInfo.score) || 0),
        status: Number((localInfo && localInfo.status) || definitions.status.PlanToWatch),
      };
    } else {
      if (!this.animeInfo.name) {
        this.animeInfo.name = this.getTitleFromUrl() || this.entryId;
      }
      this.animeInfo.altTitles = normalizeAltTitles(this.animeInfo.altTitles);
      this.animeInfo.aliases = normalizeAliases(this.animeInfo.aliases);
      if (!this.animeInfo.sourceUrl) {
        this.animeInfo.sourceUrl = this.url;
      }
    }
  }

  async _sync() {
    await helper.upsertEntry({
      entryId: this.entryId,
      mediaType: this.getType()!,
      sourceUrl: this.animeInfo.sourceUrl || this.url,
      title: this.animeInfo.name || this.entryId,
      altTitles: normalizeAltTitles(this.animeInfo.altTitles),
      image: this.animeInfo.image,
      tags: this.animeInfo.tags,
      streamingUrl: this.animeInfo.sUrl,
      progress: Number(this.animeInfo.progress) || 0,
      volumeProgress: Number(this.animeInfo.volumeprogress) || 0,
      score: Number(this.animeInfo.score) || 0,
      status: Number(this.animeInfo.status) || definitions.status.PlanToWatch,
      totalEp: Number(this.animeInfo.totalEp) || 0,
      totalVol: Number(this.animeInfo.totalVol) || 0,
      description: this.animeInfo.description || '',
      year: Number(this.animeInfo.year) || 0,
      genres: normalizeAltTitles(this.animeInfo.genres),
      communityScore: Number(this.animeInfo.communityScore) || 0,
      format: this.animeInfo.format || '',
      airStatus: this.animeInfo.airStatus || '',
      season: this.animeInfo.season || '',
      duration: Number(this.animeInfo.duration) || 0,
      studios: normalizeAltTitles(this.animeInfo.studios),
      characters: Array.isArray(this.animeInfo.characters) ? this.animeInfo.characters : [],
    });
  }

  _delete() {
    return helper.deleteEntry(this.entryId, this.getType()!);
  }

  setStreamingUrl(streamingUrl: string): SingleAbstract {
    if (this.animeInfo && streamingUrl) this.animeInfo.sUrl = streamingUrl;
    return super.setStreamingUrl(streamingUrl);
  }

  getStreamingUrl(): string | undefined {
    if (this.animeInfo && this.animeInfo.sUrl) return this.animeInfo.sUrl;
    return super.getStreamingUrl();
  }

  getAlternativeTitles() {
    return normalizeAltTitles(this.animeInfo?.altTitles);
  }

  getLinkedAliases() {
    return normalizeAliases(this.animeInfo?.aliases).filter(alias => alias !== this.entryId);
  }

  async setAlternativeTitles(value: string) {
    this.animeInfo.altTitles = normalizeAltTitles(
      value
        .split(',')
        .map(el => el.trim())
        .filter(el => el),
    );
    await this.sync();
    await this.update();
  }

  async linkSearchCandidate(payload: {
    targetEntryId?: string;
    aliases?: string[];
    altTitles?: string[];
    title?: string;
    image?: string;
    meta?: {
      totalEp?: number;
      totalVol?: number;
      genres?: string[];
      description?: string;
      year?: number;
      communityScore?: number;
      format?: string;
      airStatus?: string;
      season?: string;
      duration?: number;
      studios?: string[];
      characters?: { name: string; img: string; url: string; subtext: string }[];
    };
  }) {
    // Inherit metadata from the chosen source (e.g. an AniList/MAL result).
    // Strictness: "replace" overwrites, "fill" only fills blanks. Synonyms are
    // always merged; the user's tags and personal score are never touched here.
    const replace = api.settings.get('mongoInheritStrictness') === 'replace';
    const fillStr = (current: string, incoming: string) =>
      incoming && (replace || !current) ? incoming : current;
    const fillNum = (current: number, incoming: number) =>
      incoming && (replace || !current) ? incoming : current;

    if (payload.image) this.animeInfo.image = fillStr(this.animeInfo.image || '', payload.image);

    if (payload.title) {
      const hasOwnTitle = this.animeInfo.name && this.animeInfo.name !== this.entryId;
      if (replace || !hasOwnTitle) this.animeInfo.name = payload.title;
    }

    const meta = payload.meta || {};
    this.animeInfo.totalEp = fillNum(
      Number(this.animeInfo.totalEp) || 0,
      Number(meta.totalEp) || 0,
    );
    this.animeInfo.totalVol = fillNum(
      Number(this.animeInfo.totalVol) || 0,
      Number(meta.totalVol) || 0,
    );
    this.animeInfo.year = fillNum(Number(this.animeInfo.year) || 0, Number(meta.year) || 0);
    this.animeInfo.communityScore = fillNum(
      Number(this.animeInfo.communityScore) || 0,
      Number(meta.communityScore) || 0,
    );
    this.animeInfo.description = fillStr(this.animeInfo.description || '', meta.description || '');
    this.animeInfo.duration = fillNum(
      Number(this.animeInfo.duration) || 0,
      Number(meta.duration) || 0,
    );
    this.animeInfo.format = fillStr(this.animeInfo.format || '', meta.format || '');
    this.animeInfo.airStatus = fillStr(this.animeInfo.airStatus || '', meta.airStatus || '');
    this.animeInfo.season = fillStr(this.animeInfo.season || '', meta.season || '');

    const incomingGenres = normalizeAltTitles(meta.genres);
    if (incomingGenres.length) {
      this.animeInfo.genres = replace
        ? incomingGenres
        : normalizeAltTitles([...(this.animeInfo.genres || []), ...incomingGenres]);
    }

    const incomingStudios = normalizeAltTitles(meta.studios);
    if (incomingStudios.length) {
      this.animeInfo.studios = replace
        ? incomingStudios
        : normalizeAltTitles([...(this.animeInfo.studios || []), ...incomingStudios]);
    }

    // Characters are a snapshot, not additive: replace, or fill when none stored.
    const incomingCharacters = Array.isArray(meta.characters) ? meta.characters : [];
    if (incomingCharacters.length) {
      const hasStored =
        Array.isArray(this.animeInfo.characters) && this.animeInfo.characters.length > 0;
      if (replace || !hasStored) this.animeInfo.characters = incomingCharacters;
    }

    // Synonyms are additive: merge incoming alt titles (and the source title)
    // into the entry and persist them with the main write, not only via /link.
    const altTitles = normalizeAltTitles([
      ...(this.animeInfo.altTitles || []),
      ...(payload.altTitles || []),
      payload.title || '',
    ]);
    this.animeInfo.altTitles = altTitles;

    await this.sync();

    const aliases = normalizeAliases(payload.aliases || []);

    await helper.linkEntry({
      entryId: this.entryId,
      mediaType: this.getType()!,
      targetEntryId: payload.targetEntryId,
      aliases,
      altTitles,
    });

    for (let i = 0; i < 8; i++) {
      await this.update();
      if (this.isOnList()) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  async unlinkSearchCandidate(payload: { targetEntryId?: string; alias?: string }) {
    await helper.unlinkEntry({
      entryId: this.entryId,
      mediaType: this.getType()!,
      targetEntryId: payload.targetEntryId,
      alias: payload.alias,
    });

    for (let i = 0; i < 8; i++) {
      await this.update();
      if (payload.targetEntryId && !this.getLinkedAliases().includes(payload.targetEntryId)) {
        break;
      }
      if (payload.alias && !this.getLinkedAliases().includes(payload.alias)) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
}
