import { SingleAbstract } from '../singleAbstract';
import { UrlNotSupportedError } from '../Errors';
import * as definitions from '../definitions';
import * as helper from './helper';
import { pathToUrl, urlToSlug } from '../../utils/slugs';

export class Single extends SingleAbstract {
  constructor(protected url: string) {
    super(url);
    this.logger = con.m(this.shortName, '#1b7f6b');
    this.animeInfo = {};
    return this;
  }

  private animeInfo: any;

  protected key!: string;

  protected entryId!: string;

  shortName = 'SpaceTimeDB';

  authenticationUrl = 'https://spacetimedb.com';

  protected rewatchingSupport = false;

  protected datesSupport = false;

  protected handleUrl(url) {
    if (url.match(/^stdb:\/\/(anime|manga)\/.*/i)) {
      this.type = utils.urlPart(url, 2) === 'anime' ? 'anime' : 'manga';
      this.entryId = decodeURIComponent(utils.urlPart(url, 3));
      this.key = `stdb://${this.type}/${encodeURIComponent(this.entryId)}`;
      return;
    }

    if (url.match(/^local:\/\/[^/]+\/(anime|manga)\/[^/]+/i)) {
      this.type = utils.urlPart(url, 3) === 'anime' ? 'anime' : 'manga';
      this.entryId = decodeURIComponent(utils.urlPart(url, 4));
      this.key = `stdb://${this.type}/${encodeURIComponent(this.entryId)}`;
      return;
    }

    const slugObj = urlToSlug(url);
    if (!slugObj.path) {
      throw new UrlNotSupportedError(url);
    }

    this.type = slugObj.path.type;
    this.entryId = slugObj.path.slug;
    this.key = `stdb://${this.type}/${encodeURIComponent(this.entryId)}`;
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
    throw new Error('SpaceTimeDB sync does not support Start Date');
  }

  _setStartDate(startDate) {
    throw new Error('SpaceTimeDB sync does not support Start Date');
  }

  _getFinishDate(): never {
    throw new Error('SpaceTimeDB sync does not support Finish Date');
  }

  _setFinishDate(finishDate) {
    throw new Error('SpaceTimeDB sync does not support Finish Date');
  }

  _getRewatchCount(): never {
    throw new Error('SpaceTimeDB sync does not support Rewatch Count');
  }

  _setRewatchCount(rewatchCount) {
    throw new Error('SpaceTimeDB sync does not support Rewatch Count');
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
    if (raw) return this.animeInfo.name;
    return `[SDB] ${this.animeInfo.name}`;
  }

  _getTotalEpisodes() {
    return 0;
  }

  _getTotalVolumes() {
    return 0;
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

    return 'https://spacetimedb.com';
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
    return Promise.resolve('SpaceTimeDB');
  }

  async _update() {
    this.logger.log('[SpaceTimeDB]', 'update:start', {
      entryId: this.entryId,
      type: this.getType(),
    });

    this._authenticated = true;
    this.animeInfo = await helper.getEntry(this.entryId);

    this._onList = true;

    if (!this.animeInfo) {
      this._onList = false;
      const localInfo =
        /^local:\/\//i.test(this.url) && api.storage ? await api.storage.get(this.url) : null;

      this.logger.log('[SpaceTimeDB]', 'update:miss, creating local placeholder', {
        entryId: this.entryId,
        hasLocalFallback: Boolean(localInfo),
      });
      this.animeInfo = {
        name: (localInfo && localInfo.name) || this.entryId,
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
        this.animeInfo.name = this.entryId;
      }
      if (!this.animeInfo.sourceUrl) {
        this.animeInfo.sourceUrl = this.url;
      }
      this.logger.log('[SpaceTimeDB]', 'update:hit', {
        entryId: this.entryId,
        status: this.animeInfo.status,
        progress: this.animeInfo.progress,
        volumeprogress: this.animeInfo.volumeprogress,
      });
    }
  }

  async _sync() {
    this.logger.log('[SpaceTimeDB]', 'sync:start', {
      entryId: this.entryId,
      status: this.animeInfo.status,
      progress: this.animeInfo.progress,
      volumeprogress: this.animeInfo.volumeprogress,
      score: this.animeInfo.score,
    });

    await helper.upsertEntry({
      entryId: this.entryId,
      mediaType: this.getType()!,
      sourceUrl: this.animeInfo.sourceUrl || this.url,
      title: this.animeInfo.name || this.entryId,
      image: this.animeInfo.image,
      tags: this.animeInfo.tags,
      streamingUrl: this.animeInfo.sUrl,
      progress: Number(this.animeInfo.progress) || 0,
      volumeProgress: Number(this.animeInfo.volumeprogress) || 0,
      score: Number(this.animeInfo.score) || 0,
      status: Number(this.animeInfo.status) || definitions.status.PlanToWatch,
    });

    this.logger.log('[SpaceTimeDB]', 'sync:done', { entryId: this.entryId });
  }

  _delete() {
    this.logger.log('[SpaceTimeDB]', 'delete:start', { entryId: this.entryId });
    return helper.deleteEntry(this.entryId, this.getType()!).then(() => {
      this.logger.log('[SpaceTimeDB]', 'delete:done', { entryId: this.entryId });
    });
  }

  // Overload
  setStreamingUrl(streamingUrl: string): SingleAbstract {
    if (this.animeInfo && streamingUrl) this.animeInfo.sUrl = streamingUrl;
    return super.setStreamingUrl(streamingUrl);
  }

  getStreamingUrl(): string | undefined {
    if (this.animeInfo && this.animeInfo.sUrl) return this.animeInfo.sUrl;
    return super.getStreamingUrl();
  }
}
