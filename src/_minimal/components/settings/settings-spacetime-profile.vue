<template>
  <SettingsGeneral component="button" :title="title">
    <template #component>
      <div class="profile-row">
        <FormText
          v-model="draftProfile"
          :validation="validProfile"
          placeholder="profile1"
          :simple-placeholder="true"
          class="profile-input"
        />
        <FormButton color="primary" :disabled="!canApply" @click="applyProfile">Apply</FormButton>
      </div>
    </template>
  </SettingsGeneral>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import SettingsGeneral from './settings-general.vue';
import FormText from '../form/form-text.vue';
import FormButton from '../form/form-button.vue';

defineProps({
  title: {
    type: String,
    required: true,
  },
});

function normalizeProfile(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function validProfile(value: string): boolean {
  return /^[a-z0-9_-]{1,64}$/i.test(normalizeProfile(value));
}

const currentProfile = computed(() =>
  normalizeProfile(api.settings.get('spacetimeProfile') || 'profile1'),
);
const draftProfile = ref(currentProfile.value);

watch(currentProfile, value => {
  draftProfile.value = value;
});

const canApply = computed(() => {
  const next = normalizeProfile(draftProfile.value);
  return validProfile(next) && next !== currentProfile.value;
});

async function applyProfile() {
  const next = normalizeProfile(draftProfile.value);
  if (!validProfile(next)) {
    return;
  }

  const previous = currentProfile.value;
  const skipConfirm = Boolean(api.settings.get('spacetimeProfileConfirmSkip'));
  const lastConfirmed = normalizeProfile(api.settings.get('spacetimeProfileLastConfirmed') || '');

  if (!skipConfirm && next !== previous && next !== lastConfirmed) {
    const checkboxId = 'profile-confirm-skip';
    const confirmed = await utils.flashConfirm(
      `<div style="border:2px solid #e53935;border-radius:10px;padding:10px 12px;background:rgba(229,57,53,0.08);">You changed your profile.<br>This will open a different list, so your current entries may seem to disappear.<br>Do you want to continue?<div style="margin-top:8px;text-align:left;"><label style="cursor:pointer;"><input id="${checkboxId}" type="checkbox" style="margin-right:6px;"/>Don't show this again</label></div></div>`,
      'profile-confirm',
      () => {
        // Placeholder callback.
      },
      () => {
        // Placeholder callback.
      },
      true,
    );

    if (!confirmed) {
      draftProfile.value = previous;
      return;
    }

    const skipWarning = Boolean(j.$(`#${checkboxId}`).is(':checked'));
    await api.settings.set('spacetimeProfileLastConfirmed', next);
    if (skipWarning) {
      await api.settings.set('spacetimeProfileConfirmSkip', true);
    }
  }

  await api.settings.set('spacetimeProfile', next);
  draftProfile.value = next;
}
</script>

<style lang="less" scoped>
.profile-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.profile-input {
  min-width: 180px;
}
</style>
