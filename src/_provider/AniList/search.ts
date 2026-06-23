import { searchInterface } from '../definitions';
import * as helper from './helper';

export type RichMeta = {
  format: string;
  airStatus: string;
  season: string;
  duration: number;
  studios: string[];
  banner: string;
  characters: { name: string; img: string; url: string; subtext: string }[];
};

function titleCase(value: string): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// Focused detail query for a single media id, returning the scalar fields and
// characters we persist on a MongoDB entry (kept separate from the 25-result
// search query, which must stay lightweight).
export async function getRichMeta(id: number, type: 'anime' | 'manga'): Promise<RichMeta> {
  const query = `
    query ($id: Int, $type: MediaType) {
      Media (id: $id, type: $type) {
        format
        status
        season
        seasonYear
        duration
        bannerImage
        studios {
          edges {
            isMain
            node { name }
          }
        }
        characters (perPage: 12, sort: [ROLE, ID]) {
          edges {
            role
            node {
              siteUrl
              name { full }
              image { large }
            }
          }
        }
      }
    }
  `;

  const res = await helper.apiCall(query, { id, type: type.toUpperCase() }, false);
  const media = res?.data?.Media || {};

  const studioEdges = media.studios?.edges || [];
  let studios: string[] = studioEdges
    .filter(edge => edge.isMain)
    .map(edge => edge.node?.name)
    .filter(Boolean);
  if (!studios.length) {
    studios = studioEdges.map(edge => edge.node?.name).filter(Boolean);
  }

  const characters = (media.characters?.edges || [])
    .map(edge => ({
      name: edge.node?.name?.full || '',
      img: helper.imgCheck(edge.node?.image?.large) || '',
      url: edge.node?.siteUrl || '',
      subtext: titleCase(edge.role || ''),
    }))
    .filter(character => character.name);

  const season =
    media.season && media.seasonYear
      ? `${titleCase(media.season)} ${media.seasonYear}`
      : titleCase(media.season || '');

  return {
    format: titleCase(media.format || ''),
    airStatus: titleCase(media.status || ''),
    season,
    duration: Number(media.duration) || 0,
    studios,
    banner: helper.imgCheck(media.bannerImage) || '',
    characters,
  };
}

export const search: searchInterface = async function (
  keyword,
  type: 'anime' | 'manga',
  options = {},
  sync = false,
) {
  const query = `
    query ($search: String) {
      ${type}: Page (perPage: 25) {
        pageInfo {
          total
        }
        results: media (type: ${type.toUpperCase()}, search: $search) {
          id
          siteUrl
          idMal
          episodes
          chapters
          title {
            userPreferred
            romaji
            english
            native
          }
          coverImage {
            large
            extraLarge
          }
          bannerImage
          type
          format
          averageScore
          genres
          description
          startDate {
            year
          }
          synonyms
        }
      }
    }
  `;

  const variables = {
    search: keyword,
  };

  const res = await helper.apiCall(query, variables, false);
  con.log(res);

  const resItems: any = [];

  j.$.each(res.data[type].results, function (index, item) {
    resItems.push({
      id: item.id,
      name: item.title.userPreferred,
      altNames: Object.values(item.title).concat(item.synonyms),
      url: item.siteUrl,
      malUrl: () => {
        return item.idMal ? `https://myanimelist.net/${type}/${item.idMal}` : null;
      },
      image: helper.imgCheck(item.coverImage.large),
      imageLarge: helper.imgCheck(item.coverImage.extraLarge),
      imageBanner: helper.imgCheck(item.bannerImage),
      media_type: item.format
        ? (item.format.charAt(0) + item.format.slice(1).toLowerCase()).replace('_', ' ')
        : '',
      isNovel: item.format === 'NOVEL',
      score: item.averageScore,
      year: item.startDate.year,
      totalEp: item.episodes || item.chapters || 0,
      totalVol: 0,
      genres: Array.isArray(item.genres) ? item.genres : [],
      description: item.description || '',
      communityScore: item.averageScore || 0,
    });
  });

  return resItems;
};
