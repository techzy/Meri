import { config } from './config';
import type { Contact, IMessage } from './types';
import {
  queryContacts,
  getPageContent,
  createPageContent,
  updatePageContent,
  updateProperties,
} from './notion';
import { getEmailsSince } from './gmail';
import { getEventsSince } from './calendar';
import { getMessagesSince, FullDiskAccessRequiredError } from './imessage';
import { generateInitialSummary, generateDeltaUpdate } from './llm';
import { sleep, DailyQuotaExhaustedError } from './utils';

// Track Full Disk Access warning so we only print it once per run
let fdaWarned = false;

function fetchMessagesForContact(
  contact: Contact,
  since: Date,
  until: Date,
  context: 'Backfill' | 'Delta'
): IMessage[] {
  if (!contact.phone) return [];
  try {
    return getMessagesSince(contact.phone, since, until);
  } catch (err) {
    if (err instanceof FullDiskAccessRequiredError) {
      if (!fdaWarned) {
        console.warn(`[iMessage] ${err.message}`);
        fdaWarned = true;
      }
      return [];
    }
    console.error(`[${context}] iMessage error for ${contact.name}:`, (err as Error).message);
    return [];
  }
}

// ─── Loop 1: Initial Backfill ────────────────────────────────────────────────

export async function initialBackfill(contact: Contact): Promise<void> {
  console.log(`[Backfill] ${contact.name} <${contact.email || contact.phone || 'no contact info'}>`);

  if (!contact.email && !contact.phone) {
    console.warn(`[Backfill] Skipped ${contact.name}: no email or phone`);
    return;
  }

  const since = new Date();
  since.setMonth(since.getMonth() - config.backfillMonths);

  const emails = contact.email
    ? await getEmailsSince(contact.email, since).catch(err => {
        console.error(`[Backfill] Gmail error for ${contact.name}:`, (err as Error).message);
        return [];
      })
    : [];
  const events = contact.email
    ? await getEventsSince(contact.email, since).catch(err => {
        console.error(`[Backfill] Calendar error for ${contact.name}:`, (err as Error).message);
        return [];
      })
    : [];
  const messages = fetchMessagesForContact(contact, since, new Date(), 'Backfill');

  console.log(
    `[Backfill] ${contact.name}: ${emails.length} emails, ${events.length} events, ${messages.length} iMessages`
  );

  const llmResult = await generateInitialSummary(contact, emails, events, messages);

  await createPageContent(contact.pageId, llmResult);
  await updateProperties(contact.pageId, llmResult.properties, new Date().toISOString());

  console.log(`[Backfill] Done: ${contact.name}`);
}

// ─── Loop 2: Daily Delta Update ──────────────────────────────────────────────

export async function deltaUpdate(contact: Contact): Promise<void> {
  console.log(`[Delta] ${contact.name} <${contact.email || contact.phone || 'no contact info'}>`);

  if (!contact.lastSynced) {
    console.warn(`[Delta] Skipped ${contact.name}: missing lastSynced (run backfill first)`);
    return;
  }
  if (!contact.email && !contact.phone) {
    console.warn(`[Delta] Skipped ${contact.name}: no email or phone`);
    return;
  }

  const since = new Date(contact.lastSynced);
  const until = new Date();

  const emails = contact.email
    ? await getEmailsSince(contact.email, since, until).catch(err => {
        console.error(`[Delta] Gmail error for ${contact.name}:`, (err as Error).message);
        return [];
      })
    : [];
  const events = contact.email
    ? await getEventsSince(contact.email, since, until).catch(err => {
        console.error(`[Delta] Calendar error for ${contact.name}:`, (err as Error).message);
        return [];
      })
    : [];
  const messages = fetchMessagesForContact(contact, since, until, 'Delta');

  // Token saver: skip LLM entirely if nothing new across any source
  if (emails.length === 0 && events.length === 0 && messages.length === 0) {
    console.log(`[Delta] No new data for ${contact.name} — skipping`);
    return;
  }

  console.log(
    `[Delta] ${contact.name}: ${emails.length} emails, ${events.length} events, ${messages.length} iMessages`
  );

  const pageContent = await getPageContent(contact.pageId);
  const currentActions = pageContent.actionBlocks.map(b => b.text);

  const llmResult = await generateDeltaUpdate(
    contact,
    pageContent.summaryText,
    currentActions,
    emails,
    events,
    messages
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
      if (err instanceof DailyQuotaExhaustedError) {
        console.warn(
          '[Sync] Gemini free-tier daily quota exhausted — aborting. Remaining contacts will resume on next run after midnight Pacific.'
        );
        break;
      }
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
      if (err instanceof DailyQuotaExhaustedError) {
        console.warn(
          '[Sync] Gemini free-tier daily quota exhausted — aborting. Remaining contacts will resume on next run after midnight Pacific.'
        );
        break;
      }
      console.error(`[Sync] Delta failed for ${contact.name}:`, (err as Error).message);
    }
    await sleep(config.notionRateLimitDelay);
  }

  console.log('[Sync] Daily sync complete');
}

/**
 * Force-flush: process EVERY contact in one pass.
 * - First runs the backfill loop for any contact missing Last Synced
 *   (new contacts, including phone-only ones)
 * - Then runs the delta loop for every existing contact, checking each
 *   for new emails / events / iMessages since their Last Synced timestamp
 *
 * The token-saver still applies in the delta loop (skips LLM if nothing
 * is new) — that's not a wasted call, it's the system correctly reporting
 * "no change". If you actually want to regenerate a summary that has no
 * new data, clear the contact's Last Synced in Notion to force a backfill.
 */
export async function runFullSync(): Promise<void> {
  const startedAt = new Date();
  console.log(`[Sync] ═══ Full sync started at ${startedAt.toISOString()} ═══`);
  console.log('[Sync] Phase 1/2: backfilling new contacts...');
  await runNewContactsSync();
  console.log('[Sync] Phase 2/2: delta-checking existing contacts...');
  await runDailySync();
  const elapsedSec = Math.round((Date.now() - startedAt.getTime()) / 1000);
  console.log(`[Sync] ═══ Full sync complete in ${elapsedSec}s ═══`);
}
