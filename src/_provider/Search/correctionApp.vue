<template>
  <div v-if="syncPage" id="material">
    <div class="m-s-pill-section">
      <div class="m-s-pill">
        <a href="https://malsync.moe/pwa/#/settings" target="_blank">
          {{ lang('minimalApp_Settings') }}→
        </a>
      </div>
    </div>
    <div v-if="syncMode && minimized">
      <a style="cursor: pointer" @click="minimized = false"> Action required </a>
    </div>
    <div v-else class="scroll">
      <div v-if="busy" class="m-s-pill" style="margin-bottom: 8px">{{ busyMessage }}</div>
      <entry v-if="!syncMode" :obj="syncPage.singleObj"></entry>
      <rules :obj="rulesClass"></rules>

      <input-button
        v-if="!syncMode"
        label="URL"
        :state="searchClass.getUrl()"
        @clicked="setPage"
      ></input-button>

      <input-button
        v-if="!syncMode"
        :label="lang('correction_Offset')"
        :state="offset"
        type="number"
        @clicked="setOffset"
        @changed="val => (inputOffset = val)"
      ></input-button>

      <input-button
        v-if="isLinkBasedEntry"
        label="Alternative titles (comma separated)"
        :state="altTitlesState"
        @clicked="setAlternativeTitles"
      ></input-button>

      <div v-if="inputOffset && inputOffset !== '0'" id="offsetUi">
        <div v-for="index in episodeWindow" :key="index" class="offsetBox">
          <div class="mdl-color--primary top">{{ index }}</div>
          <div
            class="bottom"
            :class="{
              active: parseInt(currentStateEp) === calcEpOffset(index),
            }"
          >
            {{ calcEpOffset(index) }}
          </div>
        </div>
        <div class="offsetBox">
          <div class="mdl-color--primary top">...</div>
          <div class="bottom">...</div>
        </div>
        <div class="offsetBox">
          <div class="mdl-color--primary top">∞</div>
          <div class="bottom">∞</div>
        </div>
      </div>

      <search
        :keyword="searchClass.getSanitizedTitle()"
        :type="searchClass.getNormalizedType()"
        :sync-mode="Boolean(syncMode)"
        :current-id="searchClass.getId()"
        :linked-aliases="linkedAliases"
        @clicked="onSearchItemClick"
      ></search>
    </div>
    <a v-if="!(syncMode && minimized)" class="close" @click="close()">{{ lang('close') }}</a>
  </div>
</template>

<script lang="ts">
import search from './components/search.vue';
import inputButton from './components/inputButton.vue';
import entry from './components/entry.vue';
import rules from './components/rules.vue';
import { hideFloatbutton, showFloatbutton } from '../../floatbutton/init';
import { getRichMeta, RichMeta } from '../AniList/search';

export default {
  components: {
    entry,
    inputButton,
    search,
    rules,
  },
  data: () => ({
    inputOffset: 0 as number | '0',
    minimized: false,
    busy: false,
    busyMessage: '',
    syncMode: null,
    searchClass: null as any,
    unmountFnc: () => {
      // placeholder
    },
  }),
  computed: {
    syncPage() {
      return this.searchClass ? this.searchClass.getSyncPage() : null;
    },
    rulesClass() {
      return this.searchClass.rules;
    },
    currentStateEp() {
      if (this.syncPage && this.syncPage.curState && this.syncPage.curState.detectedEpisode) {
        return this.syncPage.curState.detectedEpisode;
      }
      return 1;
    },
    offset() {
      return this.searchClass.getOffset();
    },
    isSpaceTimeDbEntry() {
      const singleObj = this.syncPage && this.syncPage.singleObj;
      return Boolean(singleObj && singleObj.shortName === 'SpaceTimeDB');
    },
    isMongoDbEntry() {
      const singleObj = this.syncPage && this.syncPage.singleObj;
      return Boolean(singleObj && singleObj.shortName === 'MongoDB');
    },
    isLinkBasedEntry() {
      return this.isSpaceTimeDbEntry || this.isMongoDbEntry;
    },
    altTitlesState() {
      const singleObj = this.syncPage && this.syncPage.singleObj;
      if (!singleObj || typeof singleObj.getAlternativeTitles !== 'function') return '';
      const titles = singleObj.getAlternativeTitles();
      return Array.isArray(titles) ? titles.join(', ') : '';
    },
    linkedAliases() {
      const singleObj = this.syncPage && this.syncPage.singleObj;
      if (!singleObj || typeof singleObj.getLinkedAliases !== 'function') return [];
      const aliases = singleObj.getLinkedAliases();
      return Array.isArray(aliases) ? aliases : [];
    },
    episodeWindow() {
      let start = this.currentStateEp + parseInt(this.inputOffset) - 2;
      if (start < 1) start = 1;
      return Array.from({ length: 5 }, (_, i) => i + start);
    },
  },
  created() {
    this.minimized = api.settings.get('minimizeBigPopup');
    if (api.settings.get('floatButtonCorrection')) hideFloatbutton(true);
  },
  unmounted() {
    this.unmountFnc();
    showFloatbutton();
  },
  methods: {
    lang: api.storage.lang,
    async onSearchItemClick(payload) {
      if (this.busy) return;
      await this.setPage(payload?.url || '', payload?.id || 0, payload?.item || null);
    },
    getLookupAlias(item, url, id) {
      if (!item || item.source === 'SpaceTimeDB' || item.source === 'MongoDB') return '';

      const source = String(item.source || '').toLowerCase();
      if (Number.isFinite(id) && id > 0) {
        if (source.includes('anilist')) return `anilist:${id}`;
        if (source.includes('myanimelist') || /myanimelist\.net/i.test(url || ''))
          return `mal:${id}`;
        if (source.includes('kitsu')) return `kitsu:${id}`;
        if (source.includes('simkl')) return `simkl:${id}`;
        if (source.includes('shiki')) return `shiki:${id}`;
      }

      if (url) return `url:${url}`;
      return '';
    },
    async setPage(url, id = 0, item: any = null) {
      if (this.isLinkBasedEntry) {
        const singleObj = this.syncPage && this.syncPage.singleObj;
        const providerLabel = this.isMongoDbEntry ? 'MongoDB' : 'SpaceTimeDB';
        if (!singleObj || typeof singleObj.linkSearchCandidate !== 'function') {
          utils.flashm(`${providerLabel} link target is unavailable`, { error: true });
          return;
        }

        let targetEntryId = '';
        if (item && item.source === 'SpaceTimeDB') targetEntryId = String(item.sdbEntryId || '');
        else if (item && item.source === 'MongoDB') targetEntryId = String(item.mongoEntryId || '');

        // Clicking the current entry itself is not a valid link target.
        const ownEntryId =
          typeof singleObj.getPageId === 'function' ? String(singleObj.getPageId() || '') : '';
        if (targetEntryId && ownEntryId && targetEntryId === ownEntryId) {
          this.searchClass.changed = false;
          utils.flashm('This is already the current entry');
          this.close();
          return;
        }

        const lookupAlias = this.getLookupAlias(item, url, id);
        const existingAliases =
          typeof singleObj.getLinkedAliases === 'function' ? singleObj.getLinkedAliases() : [];
        const isLinkedTarget = Boolean(targetEntryId && existingAliases.includes(targetEntryId));

        // No target entry id means this is an external source (AniList/MAL
        // lookup) the user picked to enrich the current entry, rather than
        // another stored entry to dedup-link against.
        const isExternalSource = !targetEntryId;

        let busyMessage = 'Linking entries...';
        if (isLinkedTarget) busyMessage = 'Removing link...';
        else if (isExternalSource) busyMessage = 'Importing metadata...';

        this.busy = true;
        this.busyMessage = busyMessage;
        try {
          if (isLinkedTarget && typeof singleObj.unlinkSearchCandidate === 'function') {
            await singleObj.unlinkSearchCandidate({ targetEntryId });
          } else {
            // For an external source, fetch the detail fields (format/status/
            // season/duration/studios/characters) that the search result doesn't
            // carry, so they can be stored on the entry too.
            let rich: Partial<RichMeta> = {};
            if (isExternalSource && Number(item?.id) > 0) {
              try {
                rich = await getRichMeta(Number(item.id), this.searchClass.getNormalizedType());
              } catch (e) {
                con.error('[Correction] rich meta fetch failed', e);
              }
            }

            await singleObj.linkSearchCandidate({
              targetEntryId: targetEntryId || undefined,
              aliases: lookupAlias ? [lookupAlias] : [],
              altTitles: Array.isArray(item?.altNames) ? item.altNames : [],
              title: item?.name || '',
              image: isExternalSource ? item?.imageLarge || item?.image || '' : undefined,
              meta: isExternalSource
                ? {
                    totalEp: Number(item?.totalEp) || 0,
                    totalVol: Number(item?.totalVol) || 0,
                    genres: Array.isArray(item?.genres) ? item.genres : [],
                    description: item?.description || '',
                    year: Number(item?.year) || 0,
                    communityScore: Number(item?.communityScore ?? item?.score) || 0,
                    format: rich.format || '',
                    airStatus: rich.airStatus || '',
                    season: rich.season || '',
                    duration: Number(rich.duration) || 0,
                    studios: Array.isArray(rich.studios) ? rich.studios : [],
                    characters: Array.isArray(rich.characters) ? rich.characters : [],
                  }
                : undefined,
            });
          }

          this.searchClass.changed = false;

          if (this.syncPage && typeof this.syncPage.fillUI === 'function') {
            this.syncPage.fillUI();
          }

          let resultMessage = `Imported metadata into ${providerLabel} entry`;
          if (isLinkedTarget) resultMessage = `Removed ${providerLabel} link`;
          else if (targetEntryId) resultMessage = `Linked ${providerLabel} entries`;
          utils.flashm(resultMessage);
          this.close();
        } finally {
          this.busy = false;
          this.busyMessage = '';
        }
        return;
      }

      this.searchClass.setUrl(url, id);
      utils.flashm(api.storage.lang('correction_NewUrl', [url]));
      this.close();
    },
    setOffset(offset) {
      this.searchClass.setOffset(offset);
    },
    async setAlternativeTitles(value) {
      const singleObj = this.syncPage && this.syncPage.singleObj;
      if (!singleObj || typeof singleObj.setAlternativeTitles !== 'function') {
        return;
      }
      await singleObj.setAlternativeTitles(value);
      utils.flashm('Alternative titles updated');
    },
    close() {
      this.$.appContext.app.unmount();
    },
    calcEpOffset(ep) {
      return parseInt(ep) - parseInt(this.inputOffset);
    },
  },
};
</script>

<style lang="less">
@import './correctionStyle.less';
</style>
