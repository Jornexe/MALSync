import { ConfObj } from '../../../_provider/definitions';
import SettingsGeneral from './settings-general.vue';

export const minimal: ConfObj[] = [
  {
    key: 'listDefaultSort',
    title: () => api.storage.lang('settings_listDefaultSort'),
    props: () => ({
      component: 'dropdown',
      option: 'listDefaultSort',
      props: {
        options: [
          { title: api.storage.lang('settings_progress_default'), value: 'default' },
          { title: api.storage.lang('list_sorting_alpha'), value: 'alpha' },
          { title: api.storage.lang('list_sorting_score'), value: 'score' },
          { title: api.storage.lang('list_sorting_progress'), value: 'progress' },
          { title: api.storage.lang('list_sorting_latest_release'), value: 'latest_release' },
          { title: api.storage.lang('list_sorting_history'), value: 'updated' },
        ],
      },
      tooltip: api.storage.lang('settings_listDefaultSort_Text'),
    }),
    component: SettingsGeneral,
  },
  {
    key: 'minimalWindow',
    title: () => api.storage.lang('settings_miniMAL_window'),
    system: 'webextension',
    props: {
      component: 'checkbox',
      option: 'minimalWindow',
    },
    component: SettingsGeneral,
  },
  {
    key: 'autoCloseMinimal',
    title: () => api.storage.lang('settings_miniMAL_autoCloseMinimal'),
    system: 'userscript',
    props: {
      component: 'checkbox',
      option: 'autoCloseMinimal',
    },
    component: SettingsGeneral,
  },
  {
    key: 'posLeft',
    title: () => api.storage.lang('settings_miniMAL_Display'),
    props: () => ({
      component: 'dropdown',
      option: 'posLeft',
      props: {
        options: [
          { title: api.storage.lang('settings_miniMAL_Display_Left'), value: 'left' },
          { title: api.storage.lang('settings_miniMAL_Display_Center'), value: 'center' },
          { title: api.storage.lang('settings_miniMAL_Display_Right'), value: 'right' },
        ].filter(el => !(el.value === 'center' && api.type !== 'webextension')),
      },
    }),
    component: SettingsGeneral,
  },
  {
    key: 'miniMalHeight',
    title: () => api.storage.lang('settings_miniMAL_Height'),
    props: {
      component: 'input',
      option: 'miniMalHeight',
      props: {
        validation: (val: string) => {
          return /^\d+(%|px)$/i.test(val);
        },
      },
    },
    component: SettingsGeneral,
  },
  {
    key: 'miniMalWidth',
    title: () => api.storage.lang('settings_miniMAL_Width'),
    props: {
      component: 'input',
      option: 'miniMalWidth',
      props: {
        validation: (val: string) => {
          return /^\d+(%|px)$/i.test(val);
        },
      },
    },
    component: SettingsGeneral,
  },
  {
    key: 'pwa',
    title: () => api.storage.lang('settings_miniMAL_pwa'),
    props: () => ({
      component: 'button',
      props: {
        color: 'primary',
        title: api.storage.lang('Show'),
        link: 'https://malsync.moe/pwa/',
      },
    }),
    component: SettingsGeneral,
  },
];
