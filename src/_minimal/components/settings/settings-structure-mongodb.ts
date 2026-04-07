import { ConfObj } from '../../../_provider/definitions';
import SettingsGeneral from './settings-general.vue';
import SettingsGroup from './settings-group.vue';
import SettingsMongodbTest from './settings-mongodb-test.vue';

export const mongodb: ConfObj[] = [
  {
    key: 'mongodbEnabled',
    title: 'Enable MongoDB Sync',
    props: {
      component: 'checkbox',
      option: 'mongodbEnabled',
    },
    component: SettingsGeneral,
  },
  {
    key: 'mongodbSettings',
    title: 'MongoDB Connection Settings',
    props: () => ({
      type: 'button',
      icon: 'cloud_upload',
      condition: () => api.settings.get('mongodbEnabled'),
      props: {
        color: 'primary',
        title: 'MongoDB Connection',
      },
    }),
    component: SettingsGroup,
    children: [
      {
        key: 'mongodbUrl',
        title: 'MongoDB URL',
        props: {
          component: 'input',
          option: 'mongodbUrl',
          placeholder: 'http://localhost:27017',
        },
        component: SettingsGeneral,
      },
      {
        key: 'mongodbDatabase',
        title: 'Database Name',
        props: {
          component: 'input',
          option: 'mongodbDatabase',
          placeholder: 'malsync',
        },
        component: SettingsGeneral,
      },
      {
        key: 'mongodbUsername',
        title: 'Username (optional)',
        props: {
          component: 'input',
          option: 'mongodbUsername',
          placeholder: '',
        },
        component: SettingsGeneral,
      },
      {
        key: 'mongodbPassword',
        title: 'Password (optional)',
        props: {
          component: 'input',
          option: 'mongodbPassword',
          placeholder: '',
          props: {
            type: 'password',
          },
        },
        component: SettingsGeneral,
      },
      {
        key: 'mongodbTest',
        title: 'Connection Test',
        component: SettingsMongodbTest,
      },
    ],
  },
  {
    key: 'mongodbSyncOptions',
    title: 'Sync Options',
    props: () => ({
      type: 'button',
      icon: 'sync',
      condition: () => api.settings.get('mongodbEnabled'),
      props: {
        color: 'primary',
        title: 'Sync Options',
      },
    }),
    component: SettingsGroup,
    children: [
      {
        key: 'mongodbSyncMode',
        title: 'Sync Direction',
        props: () => ({
          component: 'dropdown',
          option: 'mongodbSyncMode',
          props: {
            options: {
              bidirectional: 'Bidirectional (Local ↔ MongoDB)',
              pushOnly: 'Push Only (Local → MongoDB)',
              pullOnly: 'Pull Only (MongoDB → Local)',
            },
          },
        }),
        component: SettingsGeneral,
      },
      {
        key: 'mongodbSyncInterval',
        title: 'Auto Sync Interval (seconds)',
        props: () => ({
          component: 'input',
          option: 'mongodbSyncInterval',
          props: {
            type: 'number',
            min: 60,
            max: 3600,
            step: 60,
          },
        }),
        component: SettingsGeneral,
      },
      {
        key: 'mongodbConflictResolution',
        title: 'Conflict Resolution',
        props: () => ({
          component: 'dropdown',
          option: 'mongodbConflictResolution',
          props: {
            options: {
              newest: 'Use Newest',
              local: 'Local Wins',
              remote: 'Remote Wins',
            },
          },
        }),
        component: SettingsGeneral,
      },
      {
        key: 'mongodbEncryptData',
        title: 'Encrypt Data Before Upload',
        props: {
          component: 'checkbox',
          option: 'mongodbEncryptData',
        },
        component: SettingsGeneral,
      },
    ],
  },
];
