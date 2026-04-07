<template>
  <div class="mongodb-settings">
    <div class="mongodb-test">
      <FormButton
        :color="testStatus === 'success' ? 'success' : 'primary'"
        :disabled="testing"
        @click="testConnection"
      >
        <span v-if="testing">Testing Connection...</span>
        <span v-else-if="testStatus === 'success'">✓ Connection Successful</span>
        <span v-else-if="testStatus === 'error'">✗ Connection Failed</span>
        <span v-else>Test Connection</span>
      </FormButton>
      
      <FormButton
        v-if="mongodbEnabled"
        color="secondary"
        :disabled="syncing"
        @click="manualSync"
      >
        <span v-if="syncing">Syncing...</span>
        <span v-else>Manual Sync Now</span>
      </FormButton>
    </div>

    <div v-if="testMessage" :class="`test-message ${testStatus}`">
      {{ testMessage }}
    </div>

    <div v-if="syncStatus" class="sync-status">
      <div class="status-item">
        <strong>Last Sync:</strong>
        {{ lastSyncTime }}
      </div>
      <div class="status-item">
        <strong>Anime Synced:</strong>
        {{ syncStatus.syncedAnime }}
      </div>
      <div class="status-item">
        <strong>Manga Synced:</strong>
        {{ syncStatus.syncedManga }}
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';
import FormButton from '../form/form-button.vue';

const testing = ref(false);
const syncing = ref(false);
const testStatus = ref<'idle' | 'success' | 'error'>('idle');
const testMessage = ref('');
const syncStatus = ref<any>(null);

const mongodbEnabled = computed(() => {
  return api.settings.get('mongodbEnabled');
});

const lastSyncTime = computed(() => {
  if (!syncStatus.value || !syncStatus.value.lastSync) {
    return 'Never';
  }
  const date = new Date(syncStatus.value.lastSync);
  return date.toLocaleString();
});

async function testConnection() {
  testing.value = true;
  testStatus.value = 'idle';
  testMessage.value = '';

  try {
    // Dynamically import to avoid issues if not available
    const { testMongoConnection } = await import('../../../api/storage/mongodb');
    const connected = await testMongoConnection();

    if (connected) {
      testStatus.value = 'success';
      testMessage.value = 'Successfully connected to MongoDB!';
    } else {
      testStatus.value = 'error';
      testMessage.value = 'Failed to connect. Check your MongoDB URL and credentials.';
    }
  } catch (error: any) {
    testStatus.value = 'error';
    testMessage.value = `Error: ${error.message}`;
  } finally {
    testing.value = false;

    // Clear message after 5 seconds
    setTimeout(() => {
      testMessage.value = '';
      if (testStatus.value !== 'error') {
        testStatus.value = 'idle';
      }
    }, 5000);
  }
}

async function manualSync() {
  syncing.value = true;
  testMessage.value = '';

  try {
    const { manualSync: performManualSync, getSyncStatus } = await import(
      '../../../background/mongoSync'
    );
    await performManualSync();
    syncStatus.value = getSyncStatus();
    testMessage.value = 'Sync completed successfully!';
    testStatus.value = 'success';
  } catch (error: any) {
    testMessage.value = `Sync error: ${error.message}`;
    testStatus.value = 'error';
  } finally {
    syncing.value = false;

    // Clear message after 5 seconds
    setTimeout(() => {
      testMessage.value = '';
      testStatus.value = 'idle';
    }, 5000);
  }
}

onMounted(async () => {
  if (mongodbEnabled.value) {
    try {
      const { getSyncStatus } = await import('../../../background/mongoSync');
      syncStatus.value = getSyncStatus();
    } catch (error) {
      console.error('Error loading sync status:', error);
    }
  }
});
</script>

<style scoped lang="less">
.mongodb-settings {
  margin-top: 1rem;
}

.mongodb-test {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
}

.test-message {
  padding: 0.75rem;
  border-radius: 4px;
  margin-bottom: 1rem;
  
  &.success {
    background-color: rgba(76, 175, 80, 0.1);
    color: #4caf50;
    border: 1px solid #4caf50;
  }
  
  &.error {
    background-color: rgba(244, 67, 54, 0.1);
    color: #f44336;
    border: 1px solid #f44336;
  }
}

.sync-status {
  padding: 1rem;
  background-color: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
  
  .status-item {
    margin-bottom: 0.5rem;
    
    &:last-child {
      margin-bottom: 0;
    }
    
    strong {
      margin-right: 0.5rem;
    }
  }
}
</style>
