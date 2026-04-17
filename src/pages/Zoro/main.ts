import { pageInterface } from '../pageInterface';

type ZoroSyncData = {
  page: 'episode' | 'anime';
  name: string;
  anime_id: string;
  mal_id: string;
  anilist_id: string;
  series_url: string;
  selector_position?: string;
  episode?: string;
  next_episode_url?: string;
};

let jsonData: ZoroSyncData;
let hasSyncData = false;

function currentDomain(): string {
  return window.location.origin;
}

function buildSyncDataFromDOM(): ZoroSyncData | null {
  const titleEl = j.$('h2.film-name.dynamic-name');
  if (!titleEl.length) return null;

  const name = titleEl.text().trim();
  const url = window.location.href;
  const hasEp = /[?&]ep=/.test(url);
  const urlPath = new URL(url).pathname;
  const slugMatch = urlPath.match(/-(\d+)(?:$|\/)/);
  const anime_id = slugMatch ? slugMatch[1] : '';

  const series_url = url.split('?')[0];

  let episode: string | undefined;
  if (hasEp) {
    const watchingText = j.$('.server-notice, .head-sub, .cat-heading').text();
    const epMatch = watchingText.match(/Episode\s+(\d+)/i);
    if (epMatch) episode = epMatch[1];

    if (!episode) {
      const activeEp = j.$('.ss-list a.active, .ep-item.active');
      if (activeEp.length) {
        episode = activeEp.attr('data-number') || activeEp.text().trim();
      }
    }
  }

  let next_episode_url: string | undefined;
  if (hasEp) {
    const activeEp = j.$('.ss-list a.active, .ep-item.active');
    if (activeEp.length) {
      const nextEp = activeEp.next('a');
      if (nextEp.length) {
        next_episode_url = utils.absoluteLink(nextEp.attr('href'), currentDomain());
      }
    }
  }

  return {
    page: hasEp ? 'episode' : 'anime',
    name,
    anime_id,
    mal_id: '',
    anilist_id: '',
    series_url,
    selector_position: '.block_area-detail .film-infor',
    episode,
    next_episode_url: next_episode_url || '',
  };
}

export const Zoro: pageInterface = {
  name: 'HiAnime',
  domain: 'https://hianime.to',
  languages: ['English'],
  type: 'anime',
  database: 'Zoro',
  isSyncPage(url) {
    return jsonData.page === 'episode';
  },
  isOverviewPage(url) {
    return jsonData.page === 'anime';
  },
  sync: {
    getTitle(url) {
      return utils.htmlDecode(jsonData.name);
    },
    getIdentifier(url) {
      return jsonData.anime_id;
    },
    getOverviewUrl(url) {
      if (hasSyncData) {
        return jsonData.series_url.replace('watch/', '');
      }
      return jsonData.series_url;
    },
    getEpisode(url) {
      return parseInt(jsonData.episode!);
    },
    nextEpUrl(url) {
      return jsonData.next_episode_url;
    },
    getMalUrl(provider) {
      if (jsonData.mal_id) return `https://myanimelist.net/anime/${jsonData.mal_id}`;
      if (provider === 'ANILIST' && jsonData.anilist_id)
        return `https://anilist.co/anime/${jsonData.anilist_id}`;
      return false;
    },
  },
  overview: {
    getTitle(url) {
      return utils.htmlDecode(jsonData.name);
    },
    getIdentifier(url) {
      return jsonData.anime_id;
    },
    uiSelector(selector) {
      j.$(jsonData.selector_position!).append(j.html(selector));
    },
    getMalUrl(provider) {
      return Zoro.sync.getMalUrl!(provider);
    },
    list: {
      offsetHandler: false,
      elementsSelector() {
        return j.$('.ss-list > a');
      },
      elementUrl(selector) {
        return utils.absoluteLink(selector.attr('href'), currentDomain());
      },
      elementEp(selector) {
        return Number(selector.attr('data-number'));
      },
    },
  },
  init(page) {
    api.storage.addStyle(
      require('!to-string-loader!css-loader!less-loader!./style.less').toString(),
    );

    let _debounce;

    utils.changeDetect(check, () => j.$('#syncData').text() + j.$('h2.film-name.dynamic-name').text());
    check();

    function check() {
      page.reset();

      if (j.$('#syncData').length) {
        hasSyncData = true;
        jsonData = JSON.parse(j.$('#syncData').text());

        clearTimeout(_debounce);
        _debounce = setTimeout(() => {
          page.handlePage();
        }, 500);
        return;
      }

      const domData = buildSyncDataFromDOM();
      if (domData) {
        hasSyncData = false;
        jsonData = domData;

        clearTimeout(_debounce);
        _debounce = setTimeout(() => {
          page.handlePage();
        }, 500);
      }
    }
  },
};
