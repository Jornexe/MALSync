<template>
  <div class="search">
    <div class="input">
      <div class="group">
        <input v-model="searchKeyword" type="text" required @focus="inputFocus()" />
        <span class="bar"></span>
        <label>{{ lang('correction_Search') }}</label>
      </div>
    </div>

    <div class="loadingBar">
      <div
        v-show="loading"
        class="mdl-progress mdl-js-progress mdl-progress__indeterminate"
        style="width: 100%"
      >
        <div class="progressbar bar bar1" style="width: 0%"></div>
        <div class="bufferbar bar bar2" style="width: 100%"></div>
        <div class="auxbar bar bar3" style="width: 0%"></div>
      </div>
    </div>

    <div v-if="searchKeyword" class="results">
      <a
        v-if="items.length === 0"
        class="result"
        href=""
        style="cursor: pointer"
        @click="clickItem($event, '')"
      >
        <div class="image"></div>
        <div class="right">
          <span class="title">{{
            lang('correction_NoEntry', [providerTemplates(type).shortName])
          }}</span>
          <p>{{ lang('correction_NoMal', [providerTemplates(type).shortName]) }}</p>
        </div>
      </a>
      <a
        v-for="item in items"
        :key="item.id"
        class="result"
        :href="item.url"
        :class="{ active: currentId === item.id, onList: item.list }"
        @click="clickItem($event, item)"
      >
        <div class="image"><img :src="item.image" /></div>
        <div class="right">
          <span class="title">{{ item.name }}</span>
          <p v-if="item.source">Source {{ item.source }}</p>
          <template v-if="item.list">
            <p>{{ lang('UI_Status') }} {{ getStatusText(type, item.list.status) }}</p>
            <p v-if="item.list.score">{{ lang('UI_Score') }} {{ item.list.score }}</p>
            <p v-else-if="item.list.status === 1">
              {{ episodeText(type) }} {{ item.list.episode }}
            </p>
          </template>
          <template v-else>
            <p v-if="item.media_type">{{ lang('search_Type') }} {{ item.media_type }}</p>
            <p v-if="item.score">{{ lang('search_Score') }} {{ item.score }}</p>
            <p v-if="item.year">{{ lang('search_Year') }} {{ item.year }}</p>
          </template>
        </div>
      </a>
    </div>
  </div>
</template>

<script lang="ts">
import { PropType } from 'vue';
import { normalSearch } from '../../../utils/Search';
import { searchResult } from '../../definitions';
import { providerTemplates } from '../../../provider/templates';
import { getSyncMode } from '../../helper';
import { getSyncList as getSpaceTimeDbSyncList } from '../../SpaceTimeDB/helper';

type SearchDisplayResult = searchResult & {
  source?: string;
};

let searchTimeout;
export default {
  components: {},
  props: {
    type: {
      type: String as PropType<'anime' | 'manga'>,
      default: 'anime',
    },
    keyword: {
      type: String,
      default: '',
    },
    syncMode: {
      type: Boolean,
      default: false,
    },
    currentId: {
      type: Number,
      default: 0,
    },
  },
  data() {
    return {
      items: [] as SearchDisplayResult[],
      loading: false,
      searchKeyword: '',
    };
  },
  watch: {
    keyword() {
      this.searchKeyword = this.keyword;
      this.load();
    },
    searchKeyword() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        this.load();
      }, 200);
    },
    type() {
      this.load();
    },
  },
  mounted() {
    if (this.syncMode) {
      this.searchKeyword = this.keyword;
      this.load();
    }
  },
  methods: {
    lang: api.storage.lang,
    getStatusText: utils.getStatusText,
    episodeText: utils.episode,
    providerTemplates,
    async getSpaceTimeDbResults(
      keyword: string,
      type: 'anime' | 'manga',
    ): Promise<SearchDisplayResult[]> {
      if (getSyncMode(type) !== 'SPACETIMEDB') {
        return [];
      }

      const searchTerm = keyword.trim().toLowerCase();
      if (!searchTerm) {
        return [];
      }

      try {
        const syncList = (await getSpaceTimeDbSyncList()) as Record<string, any>;
        const results = [] as Array<SearchDisplayResult & { _score: number }>;

        for (const [key, entry] of Object.entries(syncList)) {
          if (!new RegExp(`^stdb://${type}/`, 'i').test(key)) {
            continue;
          }

          const name = String(entry?.name || '').trim();
          const sourceUrl = String(entry?.sourceUrl || '').trim();
          const searchText = `${name} ${sourceUrl}`.toLowerCase();
          if (!searchText.includes(searchTerm)) {
            continue;
          }

          const score = name.toLowerCase().startsWith(searchTerm)
            ? 2
            : name.toLowerCase().includes(searchTerm)
              ? 1
              : 0;

          const entryId = decodeURIComponent(utils.urlPart(key, 3) || '');
          const maybeNumericId = Number(entryId);
          const parsedStatus = Number(entry?.status);
          const parsedScore = Number(entry?.score);
          const parsedProgress = Number(entry?.progress);

          results.push({
            id: Number.isFinite(maybeNumericId) ? maybeNumericId : 0,
            name: name || entryId || '[SDB] Entry',
            altNames: [],
            url: sourceUrl || `local://spacetimedb/${type}/${encodeURIComponent(entryId)}`,
            malUrl: () => Promise.resolve(null),
            image: String(entry?.image || ''),
            imageLarge: String(entry?.image || ''),
            media_type: type,
            isNovel: false,
            score: '',
            year: '',
            list: {
              status: Number.isFinite(parsedStatus) ? parsedStatus : 6,
              score: Number.isFinite(parsedScore) ? parsedScore : 0,
              episode: Number.isFinite(parsedProgress) ? parsedProgress : 0,
            },
            source: 'SpaceTimeDB',
            _score: score,
          });
        }

        return results
          .sort((a, b) => b._score - a._score)
          .map(({ _score, ...item }) => item)
          .slice(0, 8);
      } catch (error) {
        con.error('[Correction][SpaceTimeDB] Failed loading search candidates', error);
        return [];
      }
    },
    load() {
      if (this.searchKeyword) {
        this.loading = true;
        const lookupSource =
          getSyncMode(this.type) === 'SPACETIMEDB' ? 'AniList (lookup)' : providerTemplates(this.type).shortName;

        Promise.all([
          this.getSpaceTimeDbResults(this.searchKeyword, this.type),
          normalSearch(this.searchKeyword, this.type),
        ]).then(([spaceTimeDbItems, items]) => {
          this.loading = false;
          const seenUrls = new Set(spaceTimeDbItems.map(item => item.url));
          const lookupItems = items
            .filter(item => !seenUrls.has(item.url))
            .map(item => ({
              ...item,
              source: lookupSource,
            }));
          this.items = spaceTimeDbItems.concat(lookupItems);
          this.$nextTick(() => {
            this.$el.scrollIntoView({ behavior: 'smooth' });
          });
        });
      }
    },
    inputFocus() {
      if (!this.searchKeyword) {
        this.searchKeyword = this.keyword;
      }
    },
    async clickItem(e, item) {
      e.preventDefault();
      if (!item) {
        this.$emit('clicked', { url: '', id: 0 });
        return;
      }
      const url = await item.malUrl();
      if (url) {
        this.$emit('clicked', { url, id: item.id });
      } else {
        this.$emit('clicked', { url: item.url, id: item.id });
      }
    },
  },
};
</script>
