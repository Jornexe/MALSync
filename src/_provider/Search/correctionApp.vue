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
        v-if="isSpaceTimeDbEntry"
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
      if (!item || item.source === 'SpaceTimeDB') return '';

      const source = String(item.source || '').toLowerCase();
      if (Number.isFinite(id) && id > 0) {
        if (source.includes('anilist')) return `anilist:${id}`;
        if (source.includes('myanimelist') || /myanimelist\.net/i.test(url || '')) return `mal:${id}`;
        if (source.includes('kitsu')) return `kitsu:${id}`;
        if (source.includes('simkl')) return `simkl:${id}`;
        if (source.includes('shiki')) return `shiki:${id}`;
      }

      if (url) return `url:${url}`;
      return '';
    },
    async setPage(url, id = 0, item = null) {
      if (this.isSpaceTimeDbEntry) {
        const singleObj = this.syncPage && this.syncPage.singleObj;
        if (!singleObj || typeof singleObj.linkSearchCandidate !== 'function') {
          utils.flashm('SpaceTimeDB link target is unavailable', { error: true });
          return;
        }

        const targetEntryId = item && item.source === 'SpaceTimeDB' ? String(item.sdbEntryId || '') : '';
        const lookupAlias = this.getLookupAlias(item, url, id);
        const existingAliases =
          typeof singleObj.getLinkedAliases === 'function' ? singleObj.getLinkedAliases() : [];
        const isLinkedTarget = Boolean(targetEntryId && existingAliases.includes(targetEntryId));

        this.busy = true;
        this.busyMessage = isLinkedTarget ? 'Removing link...' : 'Linking entry...';
        try {
          if (isLinkedTarget && typeof singleObj.unlinkSearchCandidate === 'function') {
            await singleObj.unlinkSearchCandidate({ targetEntryId });
          } else {
            await singleObj.linkSearchCandidate({
              targetEntryId: targetEntryId || undefined,
              aliases: lookupAlias ? [lookupAlias] : [],
              altTitles: Array.isArray(item?.altNames) ? item.altNames : [],
              title: item?.name || '',
            });
          }

          this.searchClass.changed = false;

          if (this.syncPage && typeof this.syncPage.fillUI === 'function') {
            this.syncPage.fillUI();
          }

          utils.flashm(
            isLinkedTarget
              ? 'Removed SpaceTimeDB link'
              : targetEntryId
                ? 'Linked SpaceTimeDB entries'
                : 'Added alias data for SpaceTimeDB entry',
          );
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
