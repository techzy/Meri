import { config } from './config';
import type { Contact } from './types';
import {
  queryContacts,
  getPageContent,
  createPageContent,
  updatePageContent,
  updateProperties,
} from './notion';
import { getEmailsSince } from './gmail';
import { getEventsSince } from './calendar';
import { generateInitialSummary, generateDeltaUpdate } from './llm';
import { sleep } from './utils';

// ─── Loop 1: Initial Backfill ────────────────────────────────────────────────

export async function initialBackfill(contact: Contact): Promise<void> {
  console.log(`[Backfill] ${contact.name} <${contact.email}>`);

  if (!contact.email) {
    console.warn(`[Backfill] Skipped ${contact.name}: no email address`);
    return;
  }

  const since = new Date();
  since.setMonth(since.getMonth() - config.backfillMonths);

  const emails = await getEmailsSince(contact.email, since).catch(err => {
    console.error(`[Backfill] Gmail error for ${contact.name}:`, (err as Error).message);
    return [];
  });
  const events = await getEventsSince(contact.email, since).catch(err => {
    console.error(`[Backfill] Calendar error for ${contact.name}:`, (err as Error).message);
    return [];
  });

  console.log(`[Backfill] ${contact.name}: ${emails.length} emails, ${events.length} events`);

  const llmResult = await generateInitialSummary(contact, emails, events);

  await createPageContent(contact.pageId, llmResult);
  await updateProperties(contact.pageId, llmResult.properties, new Date().toISOString());

  console.log(`[Backfill] Done: ${contact.name}`);
}

// ─── Loop 2: Daily Delta Update ──────────────────────────────────────────────

export async function deltaUpdate(contact: Contact): Promise<void> {
  console.log(`[Delta] ${contact.name} <${contact.email}>`);

  if (!contact.email || !contact.lastSynced) {
    console.warn(`[Delta] Skipped ${contact.name}: missing email or lastSynced`);
    return;
  }

  const since = new Date(contact.lastSynced);
  const until = new Date();

  const emails = await getEmailsSince(contact.email, since, until).catch(err => {
    console.error(`[Delta] Gmail error for ${contact.name}:`, (err as Error).message);
    return [];
  });
  const events = await getEventsSince(contact.email, since, until).catch(err => {
    console.error(`[Delta] Calendar error for ${contact.name}:`, (err as Error).message);
    return [];
  });

  // Token saver: skip LLM entirely if nothing new
  if (emails.length === 0 && events.length === 0) {
    console.log(`[Delta] No new data for ${contact.name} — skipping`);
    return;
  }

  console.log(`[Delta] ${contact.name}: ${emails.length} emails, ${events.length} events`);

  const pageContent = await getPageContent(contact.pageId);
  const currentActions = pageContent.actionBlocks.map(b => b.text);

  const llmResult = await generateDeltaUpdate(
    contact,
    pageContent.summaryText,
    currentActions,
    emails,
    events
  );

  await updatePageContent(contact.pageId, pageContent, llmResult);
  await updateProperties(contact.pageId, llmResult.properties, new Date().toISOString());

  console.log(`[Delta] Done: ${contact.name}`);
}

// ─── Batch runners ───────────────────────────────────────────────────────────

export async function runNewContactsSync(): Promise<void> {
  console.log('[Sync] Polling for new contacts...');
  const contacts = await queryContacts('new');

  if (contacts.length === 0) {
    console.log('[Sync] No new contacts');
    return;
  }

  console.log(`[Sync] Backfilling ${contacts.length} new contact(s)`);

  for (const contact of contacts) {
    try {
      await initialBackfill(contact);
    } catch (err) {
      console.error(`[Sync] Backfill failed for ${contact.name}:`, (err as Error).message);
    }
    await sleep(config.notionRateLimitDelay);
  }
}

export async function runDailySync(): Promise<void> {
  console.log('[Sync] Starting daily delta sync...');
  const contacts = await queryContacts('existing');

  console.log(`[Sync] Processing ${contacts.length} existing contact(s)`);

  for (const contact of contacts) {
    try {
      await deltaUpdate(contact);
    } catch (err) {
      console.error(`[Sync] Delta failed for ${contact.name}:`, (err as Error).message);
    }
    await sleep(config.notionRateLimitDelay);
  }

  console.log('[Sync] Daily sync complete');
}
