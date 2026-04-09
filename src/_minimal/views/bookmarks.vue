<template>
  <div class="bookmarks">
    <Section class="controls">
      <FormSwitch
        v-model="parameters.type"
        :options="[
          {
            value: 'anime',
            title: lang('Anime'),
          },
          {
            value: 'manga',
            title: lang('Manga'),
          },
        ]"
      />
      <MediaStatusDropdown
        v-model="parameters.state"
        :type="parameters.type"
        :rewatching="
          listRequest.data
            ? listRequest.data?.seperateRewatching
            : parameters.state === status.Rewatching
        "
        :considering="
          listRequest.data
            ? listRequest.data?.consideringSupport
            : parameters.state === status.Considering
        "
      />
      <FormButton padding="pill" @click="refresh()">
        <div class="material-icons m-pill" :title="lang('updateCheck_Refresh')">refresh</div>
      </FormButton>
      <FormButton
        v-if="parameters.state === 6 || parameters.state === 3"
        padding="pill"
        @click="openRandom(parameters.state, parameters.type)"
      >
        <div class="material-icons m-pill" title="random">shuffle</div>
      </FormButton>
      <FormButton
        padding="pill"
        :disabled="syncToSpaceTimeDbLoading"
        @click="syncLocalToSpaceTimeDb()"
      >
        <div class="material-icons m-pill" :class="{ spinning: syncToSpaceTimeDbLoading }">
          {{ syncToSpaceTimeDbLoading ? 'sync' : 'cloud_upload' }}
        </div>
        {{ syncToSpaceTimeDbLoading ? 'Syncing...' : 'Sync Local -> SDB' }}
      </FormButton>
      <FormButton
        padding="pill"
        :disabled="syncToSpaceTimeDbLoading"
        @click="syncLocalToSpaceTimeDb(true)"
      >
        <div class="material-icons m-pill" :class="{ spinning: syncToSpaceTimeDbLoading }">
          {{ syncToSpaceTimeDbLoading ? 'sync' : 'cleaning_services' }}
        </div>
        {{ syncToSpaceTimeDbLoading ? 'Syncing...' : 'Sync + Clear Local' }}
      </FormButton>
      <FormButton
        padding="pill"
        :disabled="syncToSpaceTimeDbLoading"
        @click="syncSpaceTimeDbToLocal()"
      >
        <div class="material-icons m-pill" :class="{ spinning: syncToSpaceTimeDbLoading }">
          {{ syncToSpaceTimeDbLoading ? 'sync' : 'download' }}
        </div>
        {{ syncToSpaceTimeDbLoading ? 'Syncing...' : 'SDB -> Local' }}
      </FormButton>
      <div style="flex-grow: 1"></div>
      <FormDropdown
        v-if="sortingOptions && sortingOptions.length"
        v-model="sort"
        :options="sortingOptions"
        align-items="left"
        :compare-func="(el, picked) => el.toString() === picked.toString().replace('_asc', '')"
      >
        <template #select="slotProps">
          <div class="select-icon">
            <span
              v-if="slotProps.meta.asc"
              class="material-icons"
              @click.stop="
                sort.endsWith('_asc') ? (sort = sort.replace('_asc', '')) : (sort = sort + '_asc')
              "
            >
              {{ !sort.endsWith('_asc') ? 'arrow_downward' : 'arrow_upward' }}
            </span>
            <span class="material-icons">{{ slotProps.meta.icon || 'filter_list' }}</span>
          </div>
        </template>
        <template #option="slotProps">
          <TextIcon :icon="slotProps.option.meta.icon"> {{ slotProps.option.title }}</TextIcon>
        </template>
      </FormDropdown>
      <span v-else class="material-icons sortPlaceholder">filter_list</span>
      <FormDropdown
        v-model="theme"
        :options="options"
        align-items="left"
        direction="row"
        size="small"
      >
        <template #select>
          <span class="material-icons select-icon">{{ listTheme.icon }}</span>
        </template>
        <template #option="slotProps">
          <span class="material-icons select-icon">{{ slotProps.option.value }}</span>
        </template>
      </FormDropdown>
    </Section>

    <template v-if="!listRequest.error">
      <Section
        v-if="list"
        spacer="double"
        class="grid"
        :class="{ cached: cacheList.length && listRequest.loading }"
      >
        <Grid
          :key="listTheme.name"
          :min-width="listTheme.width"
          :min-width-popup="listTheme.popupWidth"
          class="grid-el"
          :class="`type-${listTheme.name.replace(' ', '-').toLowerCase()}`"
        >
          <TransitionStaggered :delay-duration="listTheme.transition">
            <component
              :is="listTheme.component"
              v-for="item in list!"
              :key="item.uid"
              :item="formatItem(item as listElement)"
            />
          </TransitionStaggered>
        </Grid>
      </Section>
      <Section v-if="!listRequest.loading && list && !list.length" class="spinner-wrap">
        <Empty />
      </Section>
      <Section v-if="listRequest.loading" class="spinner-wrap"><Spinner /></Section>
      <transition :duration="100">
        <Section
          v-if="!listRequest.loading && listRequest.data && !listRequest.data!.isDone()"
          class="spinner-wrap"
        >
          <Spinner />
        </Section>
      </transition>
    </template>

    <ErrorBookmarks :list-request="listRequest" />
  </div>
</template>

<script lang="ts" setup>
import {
  computed,
  inject,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  PropType,
  ref,
  watch,
} from 'vue';
import { useRouter } from 'vue-router';
import Spinner from '../components/spinner.vue';
import FormSwitch from '../components/form/form-switch.vue';
import { setStateContext, setTypeContext } from '../utils/state';
import Section from '../components/section.vue';
import { createRequest } from '../utils/reactive';
import { getList } from '../../_provider/listFactory';
import Grid from '../components/grid.vue';
import TransitionStaggered from '../components/transition-staggered.vue';
import { bookmarkItem } from '../minimalClass';
import { listElement } from '../../_provider/listAbstract';
import { UserList as LocalList } from '../../_provider/Local/list';
import MediaStatusDropdown from '../components/media/media-status-dropdown.vue';
import FormDropdown from '../components/form/form-dropdown.vue';
import { bookmarkFormats } from '../utils/bookmarks';
import ErrorBookmarks from '../components/error/error-bookmarks.vue';
import Empty from '../components/empty.vue';
import TextIcon from '../components/text-icon.vue';
import FormButton from '../components/form/form-button.vue';
import { urlToSlug } from '../../utils/slugs';
import { localStore } from '../../utils/localStore';
import { status } from '../../_provider/definitions';
import { getSyncMode } from '../../_provider/helper';
import { exportData as exportLocalData } from '../../_provider/Local/import';
import { getSyncList as getSpaceTimeDbSyncList, upsertEntry } from '../../_provider/SpaceTimeDB/helper';

const rootWindow = inject('rootWindow') as Window;
const rootDocument = inject('rootDocument') as Document;

const router = useRouter();

const props = defineProps({
  type: {
    type: String as PropType<'anime' | 'manga'>,
    default: 'anime',
  },
  state: {
    type: String,
    default: '2',
  },
});

const parameters = ref({
  state: Number(props.state),
  type: props.type as 'anime' | 'manga',
});
const cacheList = ref([] as listElement[]);

watch(
  () => props.type,
  value => {
    parameters.value.type = value as 'anime' | 'manga';
  },
);
watch(
  () => parameters.value.type,
  value => {
    router.push({ name: 'Bookmarks', params: { type: value } });
    if (value) setTypeContext(value);
  },
);

watch(
  () => props.state,
  value => {
    parameters.value.state = Number(value);
    if (value) setStateContext(Number(value));
  },
);
watch(
  () => parameters.value.state,
  value => {
    router.push({ name: 'Bookmarks', params: { state: Number(value) } });
  },
);

const getSort = sortingOptions => {
  const curSort = localStore.getItem(`sort/${parameters.value.type}/${parameters.value.state}`);
  if (curSort && sortingOptions.find(el => el.value === curSort.replace('_asc', '')))
    return curSort;
  return 'default';
};

const listRequest = createRequest(parameters, async param => {
  cacheList.value = [];
  let listProvider = await getList(param.value.state, param.value.type);

  listProvider.setSort(getSort(listProvider.getSortingOptions()));

  listProvider.modes.cached = true;
  listProvider.getCached().then(list => {
    cacheList.value = list;
  });

  listProvider.modes.initProgress = true;
  listProvider.initFrontendMode();

  await listProvider.getNextPage().catch(async e => {
    if (getSyncMode(param.value.type) === 'SPACETIMEDB') {
      con.log('[Bookmarks] SpaceTimeDB list failed, falling back to local list', {
        type: param.value.type,
        state: param.value.state,
        error: e,
      });

      const localListProvider = new LocalList(param.value.state, param.value.type);
      localListProvider.setSort(getSort(localListProvider.getSortingOptions()));
      localListProvider.modes.cached = true;
      localListProvider.getCached().then(list => {
        cacheList.value = list;
      });
      localListProvider.modes.initProgress = true;
      localListProvider.initFrontendMode();

      await localListProvider.getNextPage().catch(localErr => {
        throw { e: localErr, html: localListProvider.errorMessage(localErr) };
      });
      listProvider = localListProvider;
      utils.flashm('SpaceTimeDB is offline. Showing Local list.');
      return;
    }
    throw { e, html: listProvider.errorMessage(e) };
  });

  return listProvider;
});

const list = computed(() => {
  const sourceList =
    cacheList.value.length && listRequest.loading
      ? cacheList.value
      : listRequest.data && !listRequest.loading
        ? listRequest.data.getTemplist()
        : null;

  if (!sourceList) return null;

  const dedupedList: listElement[] = [];
  const localUrlIndex = new Map<string, number>();

  for (const item of sourceList) {
    const itemUrl = item.url || '';
    const itemUid = item.uid || '';
    const isLocalUrl = /^local:\/\//i.test(itemUrl);
    const isLocalUid = /^local:\/\//i.test(itemUid);
    const isSdbUid = /^stdb:\/\//i.test(itemUid);

    if (!isLocalUrl) {
      dedupedList.push(item);
      continue;
    }

    if (!localUrlIndex.has(itemUrl)) {
      localUrlIndex.set(itemUrl, dedupedList.length);
      dedupedList.push(item);
      continue;
    }

    const existingIndex = localUrlIndex.get(itemUrl)!;
    const existingItem = dedupedList[existingIndex];
    const existingUid = existingItem.uid || '';
    const existingIsLocalUid = /^local:\/\//i.test(existingUid);
    const existingIsSdbUid = /^stdb:\/\//i.test(existingUid);

    // Prefer SpaceTimeDB entries when both represent the same local source URL.
    if (existingIsLocalUid && isSdbUid) {
      dedupedList[existingIndex] = item;
    } else if (!existingIsSdbUid && !isLocalUid) {
      dedupedList[existingIndex] = item;
    }
  }

  return dedupedList;
});

const formatItem = (item: listElement): bookmarkItem => {
  const resItem = item as bookmarkItem;
  if (item.options) {
    const overview = item.options.u;
    const resumeUrlObj = item.options.r;
    const continueUrlObj = item.options.c;

    if (continueUrlObj && continueUrlObj.ep === item.watchedEp + 1) {
      resItem.streamUrl = continueUrlObj.url;
    } else if (resumeUrlObj && resumeUrlObj.ep === item.watchedEp) {
      resItem.streamUrl = resumeUrlObj.url;
    } else if (overview) {
      resItem.streamUrl = overview;
    }

    if (resItem.streamUrl) {
      resItem.streamIcon = utils.favicon(resItem.streamUrl.split('/')[2]);
    }
  }
  if (item.fn.progress?.isAiring() && item.fn.progress.progress()) {
    resItem.progressText = item.fn.progress.progress()!.getAutoText();
    resItem.progressEp = item.fn.progress.progress()!.getCurrentEpisode() || undefined;
    resItem.progress = item.fn.progress;
  }
  return resItem;
};

const options = bookmarkFormats.map(format => ({
  value: format.icon,
  title: format.name,
}));

const theme = computed({
  get() {
    return api.settings.get(`bookMarksList${props.type === 'manga' ? 'Manga' : ''}`);
  },
  set(value) {
    api.settings.set(`bookMarksList${props.type === 'manga' ? 'Manga' : ''}`, value);
  },
});

const listTheme = computed(() => {
  const f = bookmarkFormats.find(format => format.icon === theme.value);

  if (!f) {
    return bookmarkFormats[0];
  }

  return f;
});

async function loadNext() {
  if (!listRequest.data || listRequest.data.isLoading()) return;
  await listRequest.data.getNextPage();
}

const handleScroll = () => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (
    rootWindow.pageYOffset + rootWindow.innerHeight >
    rootDocument.documentElement.scrollHeight - 600
  ) {
    loadNext();
  }
};

watch(
  () => listRequest.data,
  () => handleScroll(),
);

onActivated(() => {
  rootWindow.addEventListener('scroll', handleScroll);
});

onDeactivated(() => {
  rootWindow.removeEventListener('scroll', handleScroll);
});

onMounted(() => {
  rootWindow.addEventListener('scroll', handleScroll);
});

onUnmounted(() => {
  rootWindow.removeEventListener('scroll', handleScroll);
});

const sortingOptions = computed(() => {
  const temp = listRequest.data ? listRequest.data.getSortingOptions(true) : [];

  return temp.map(option => ({
    value: option.value,
    title: option.title,
    meta: {
      icon: option.icon,
      asc: option.asc,
    },
  }));
});

const sort = computed({
  get() {
    return getSort(sortingOptions.value);
  },
  set(value) {
    localStore.setItem(`sort/${parameters.value.type}/${parameters.value.state}`, value);
    listRequest.execute();
  },
});

const randomListCache = {};
const syncToSpaceTimeDbLoading = ref(false);

async function openRandom(st, type) {
  const cacheKey = `${st}-${type}`;
  if (typeof randomListCache[cacheKey] === 'undefined' || !randomListCache[cacheKey].length) {
    utils.flashm('Loading');
    const listProvider = await getList(st, type);
    await listProvider
      .getCompleteList()
      .then(async res => {
        randomListCache[cacheKey] = res;
      })
      .catch(e => {
        con.error(e);
      });
  }
  if (typeof randomListCache[cacheKey] !== 'undefined' && randomListCache[cacheKey].length > 1) {
    const currentUrl =
      randomListCache[cacheKey][Math.floor(Math.random() * randomListCache[cacheKey].length)].url;
    const slugObj = urlToSlug(currentUrl);
    router.push({ name: 'Overview', params: slugObj.path });
  } else {
    utils.flashm('List is too small!');
  }
}

function refresh() {
  listRequest.execute();
}

async function collectLocalEntries() {
  const localData = (await exportLocalData()) as Record<string, any> | any[];
  const localEntryMap = new Map<string, any>();

  const pushIfLocal = (candidateKey: string, candidateItem: any) => {
    const item = candidateItem || {};
    const localUrl =
      (typeof candidateKey === 'string' && /^local:\/\//i.test(candidateKey) && candidateKey) ||
      (typeof item.url === 'string' && /^local:\/\//i.test(item.url) && item.url) ||
      (typeof item.uid === 'string' && /^local:\/\//i.test(item.uid) && item.uid) ||
      '';

    if (!localUrl || !/^local:\/\/[^/]*\/(anime|manga)\//i.test(localUrl)) {
      return;
    }

    const current = localEntryMap.get(localUrl) || {};
    localEntryMap.set(localUrl, { ...current, ...item });
  };

  if (Array.isArray(localData)) {
    for (const item of localData) {
      pushIfLocal('', item);
    }
  } else {
    for (const key in localData) {
      pushIfLocal(key, localData[key]);
    }
  }

  if (!localEntryMap.size) {
    const storageKeys = (await api.storage.list('sync')) as Record<string, any>;
    for (const key in storageKeys) {
      if (!/^local:\/\/[^/]*\/(anime|manga)\//i.test(key)) {
        continue;
      }

      try {
        const item = await api.storage.get(key);
        pushIfLocal(key, item);
      } catch (error) {
        con.error('[SpaceTimeDB] Failed reading local storage entry', { key, error });
      }
    }
  }

  return localEntryMap;
}

async function syncLocalToSpaceTimeDb(clearLocalAfterSync = false) {
  if (syncToSpaceTimeDbLoading.value) {
    return;
  }

  syncToSpaceTimeDbLoading.value = true;
  let synced = 0;
  let cleared = 0;
  let failed = 0;

  try {
    const localEntryMap = await collectLocalEntries();

    con.log('[SpaceTimeDB] Local sync candidates', {
      total: localEntryMap.size,
      keys: [...localEntryMap.keys()],
    });

    for (const [localUrl, item] of localEntryMap.entries()) {
      const mediaType = (utils.urlPart(localUrl, 3) || '').toLowerCase();
      if (mediaType !== 'anime' && mediaType !== 'manga') {
        continue;
      }

      const rawEntryId = utils.urlPart(localUrl, 4);
      if (!rawEntryId) {
        continue;
      }

      const entryId = decodeURIComponent(rawEntryId);

      try {
        await upsertEntry({
          entryId,
          mediaType,
          sourceUrl: item.sourceUrl || localUrl,
          title: item.name || entryId,
          image: item.image || '',
          tags: typeof item.tags === 'string' ? item.tags : '',
          streamingUrl: item.sUrl || '',
          progress: Math.max(0, Number(item.progress) || 0),
          volumeProgress: Math.max(0, Number(item.volumeprogress) || 0),
          score: Math.max(0, Number(item.score) || 0),
          status: Math.max(0, Number(item.status) || status.PlanToWatch),
        });

        synced++;

        if (clearLocalAfterSync) {
          await api.storage.remove(localUrl);
          cleared++;
        }
      } catch (error) {
        failed++;
        con.error('[SpaceTimeDB] Failed syncing local entry', { localUrl, error });
      }
    }

    if (!synced && !failed) {
      utils.flashm('No local anime/manga entries found to sync.');
    } else if (failed) {
      if (clearLocalAfterSync) {
        utils.flashm(`SpaceTimeDB sync completed: ${synced} synced, ${cleared} cleared, ${failed} failed.`);
      } else {
        utils.flashm(`SpaceTimeDB sync completed: ${synced} synced, ${failed} failed.`);
      }
    } else {
      if (clearLocalAfterSync) {
        utils.flashm(`SpaceTimeDB sync completed: ${synced} synced, ${cleared} local entries cleared.`);
      } else {
        utils.flashm(`SpaceTimeDB sync completed: ${synced} synced.`);
      }
    }

    refresh();
  } catch (error) {
    con.error('[SpaceTimeDB] Failed to start local sync', error);
    utils.flashm('Failed to sync local entries to SpaceTimeDB.');
  } finally {
    syncToSpaceTimeDbLoading.value = false;
  }
}

async function syncSpaceTimeDbToLocal() {
  if (syncToSpaceTimeDbLoading.value) {
    return;
  }

  syncToSpaceTimeDbLoading.value = true;
  let imported = 0;
  let failed = 0;

  try {
    const sdbData = (await getSpaceTimeDbSyncList()) as Record<string, any>;

    for (const key in sdbData) {
      const mediaType = (utils.urlPart(key, 2) || '').toLowerCase();
      if (mediaType !== 'anime' && mediaType !== 'manga') {
        continue;
      }

      const rawEntryId = utils.urlPart(key, 3);
      if (!rawEntryId) {
        continue;
      }

      const entryId = decodeURIComponent(rawEntryId);
      const item = sdbData[key] || {};
      const preferredSourceUrl = typeof item.sourceUrl === 'string' ? item.sourceUrl : '';
      const localUrl = /^local:\/\//i.test(preferredSourceUrl)
        ? preferredSourceUrl
        : `local://spacetimedb/${mediaType}/${encodeURIComponent(entryId)}`;

      try {
        await api.storage.set(localUrl, {
          name: item.name || entryId,
          tags: typeof item.tags === 'string' ? item.tags : '',
          sUrl: item.sUrl || '',
          image: item.image || '',
          progress: Math.max(0, Number(item.progress) || 0),
          volumeprogress: Math.max(0, Number(item.volumeprogress) || 0),
          score: Math.max(0, Number(item.score) || 0),
          status: Math.max(0, Number(item.status) || status.PlanToWatch),
          sourceUrl: item.sourceUrl || '',
        });

        imported++;
      } catch (error) {
        failed++;
        con.error('[SpaceTimeDB] Failed importing SDB entry to local', { key, localUrl, error });
      }
    }

    if (!imported && !failed) {
      utils.flashm('No SpaceTimeDB entries found to import.');
    } else if (failed) {
      utils.flashm(`SDB -> Local completed: ${imported} imported, ${failed} failed.`);
    } else {
      utils.flashm(`SDB -> Local completed: ${imported} imported.`);
    }

    refresh();
  } catch (error) {
    con.error('[SpaceTimeDB] Failed importing entries to local', error);
    utils.flashm('Failed to import entries from SpaceTimeDB to local.');
  } finally {
    syncToSpaceTimeDbLoading.value = false;
  }
}
</script>

<style lang="less" scoped>
@import '../less/_globals.less';
.bookmarks {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
}
.spinner-wrap {
  flex-grow: 1;
  display: flex;
  align-items: center;
}
.controls {
  display: flex;
  gap: @spacer-half;
  flex-wrap: wrap;
  min-height: 30px;
}

.grid {
  transition:
    filter @normal-transition,
    opacity @normal-transition;
  &.cached {
    opacity: 0.4;
    filter: grayscale(1);
    transition: none;
  }

  .grid-el {
    &.type-tiles {
      gap: 20px;
      .__breakpoint-popup__({
        gap: @spacer;
      });
    }
  }
}

.sortPlaceholder {
  padding-top: 3px;
  pointer-events: not-allowed;
}

.select-icon {
  display: flex;
}

.spinning {
  animation: spinning 1s linear infinite;
}

@keyframes spinning {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.__breakpoint-popup__({
  .m-pill {
    font-size: 20px;
  }
});
</style>
