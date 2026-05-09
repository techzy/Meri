import { setupDailyFileLogging } from './logger';
setupDailyFileLogging();

import { runDailySync, runFullSync, runNewContactsSync } from './sync';

const command = process.argv[2];

async function main(): Promise<void> {
  if (command === 'daily') {
    await runDailySync();
  } else if (command === 'new') {
    await runNewContactsSync();
  } else if (command === 'all') {
    await runFullSync();
  } else {
    console.error('Usage: ts-node src/cli.ts [daily|new|all]');
    console.error('  new   — backfill contacts missing Last Synced');
    console.error('  daily — delta-update existing contacts');
    console.error('  all   — force-flush: backfill + delta in one pass');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
