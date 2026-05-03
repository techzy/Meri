import { runDailySync, runNewContactsSync } from './sync';

const command = process.argv[2];

async function main(): Promise<void> {
  if (command === 'daily') {
    await runDailySync();
  } else if (command === 'new') {
    await runNewContactsSync();
  } else {
    console.error('Usage: ts-node src/cli.ts [daily|new]');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
