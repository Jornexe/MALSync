<template>
  <SettingsGeneral component="button" :title="title">
    <template #component>
      <div class="server-row">
        <FormText
          v-model="draftUrl"
          :validation="validUrl"
          placeholder="http://localhost:8787"
          :simple-placeholder="true"
          class="server-input"
        />
        <FormButton color="primary" :disabled="!canApply" @click="applyUrl">Apply</FormButton>
      </div>
    </template>
  </SettingsGeneral>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import SettingsGeneral from './settings-general.vue';
import FormText from '../form/form-text.vue';
import FormButton from '../form/form-button.vue';
import { requestMongoServerPermission } from '../../../_provider/MongoDB/helper';

defineProps({
  title: {
    type: String,
    required: true,
  },
});

function normalizeUrl(value: string) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function validUrl(value: string): boolean {
  const next = normalizeUrl(value);
  if (!/^https?:\/\//i.test(next)) return false;
  try {
    const parsed = new URL(next);
    return Boolean(parsed.hostname);
  } catch (_err) {
    return false;
  }
}

const currentUrl = computed(() =>
  normalizeUrl(api.settings.get('mongoServerUrl') || 'http://localhost:8787'),
);
const draftUrl = ref(currentUrl.value);

watch(currentUrl, value => {
  draftUrl.value = value;
});

const canApply = computed(() => validUrl(normalizeUrl(draftUrl.value)));

async function applyUrl() {
  const next = normalizeUrl(draftUrl.value);
  if (!validUrl(next)) return;

  const granted = await requestMongoServerPermission(next);
  if (!granted) {
    utils.flashm('Could not grant host permission for this MongoDB server URL', { error: true });
    return;
  }

  await api.settings.set('mongoServerUrl', next);
  draftUrl.value = next;
}
</script>

<style lang="less" scoped>
.server-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.server-input {
  min-width: 220px;
}
</style>
