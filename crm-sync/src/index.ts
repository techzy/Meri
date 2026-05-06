import { setupDailyFileLogging } from './logger';
setupDailyFileLogging();

import cron from 'node-cron';
import { runNewContactsSync, runDailySync } from './sync';

console.log('[CRM Sync] Starting...');

// Poll for new contacts every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  console.log('[Cron] New-contacts poll fired');
  try {
    await runNewContactsSync();
  } catch (err) {
    console.error('[Cron] New-contacts sync failed:', (err as Error).message);
  }
});

// Daily delta sync at midnight
cron.schedule('0 0 * * *', async () => {
  console.log('[Cron] Daily delta sync fired');
  try {
    await runDailySync();
  } catch (err) {
    console.error('[Cron] Daily sync failed:', (err as Error).message);
  }
});

// Run immediately on startup to catch any contacts added while offline
void (async () => {
  try {
    await runNewContactsSync();
  } catch (err) {
    console.error('[Startup] New-contacts sync failed:', (err as Error).message);
  }
})();

console.log('[CRM Sync] Cron jobs scheduled. Waiting for triggers...');
