import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from './config';
import { geminiWithRetry, sleep } from './utils';
import type { Contact, EmailMessage, CalendarEvent, IMessage, LLMResponse } from './types';

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

// Character length above which we chunk the backfill month-by-month
const CHUNK_THRESHOLD = 15_000;
// Delay between consecutive Gemini calls to stay under free-tier RPM limits
const INTER_CALL_DELAY_MS = 15_000;

// Hard caps to keep input tokens within Gemini free-tier per-minute limits
const MAX_EMAILS = 50;
const MAX_EVENTS = 30;
const MAX_MESSAGES = 100;
const MAX_SNIPPET_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 300;
const MAX_MESSAGE_CHARS = 100;

function truncate(s: string | undefined, limit: number): string {
  if (!s) return '';
  return s.length > limit ? s.slice(0, limit) + '…' : s;
}

function capEmails(emails: EmailMessage[]): EmailMessage[] {
  // Keep the most recent N (input order is from Gmail listing — typically newest first)
  return emails.slice(0, MAX_EMAILS).map(e => ({
    ...e,
    snippet: truncate(e.snippet, MAX_SNIPPET_CHARS),
  }));
}

function capEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events.slice(0, MAX_EVENTS).map(e => ({
    ...e,
    description: e.description ? truncate(e.description, MAX_DESCRIPTION_CHARS) : undefined,
  }));
}

// Privacy filter: replace URLs, addresses, attachment markers; then truncate.
// Per user choice "Only send if message body is short" — keeps the LLM call
// useful while limiting how much sensitive iMessage content leaves the device.
function stripPersonal(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(
      /\b\d{1,5}\s+\w+(?:\s+\w+){0,3}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Trail|Tr|Highway|Hwy)\b\.?/gi,
      '[address]'
    )
    .replace(/\[attachment[^\]]*\]/gi, '[attachment]');
}

function capMessages(messages: IMessage[]): IMessage[] {
  // Most-recent N. Messages from chat.db come ordered ASC; take the tail.
  const recent = messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages;
  return recent.map(m => ({
    ...m,
    text: truncate(stripPersonal(m.text), MAX_MESSAGE_CHARS),
  }));
}

// ─── System prompts ──────────────────────────────────────────────────────────

const DELTA_SYSTEM = `You are an expert sales assistant. I am providing you with the CURRENT relationship summary and open action items for a client, along with NEW emails and calendar events from the last sync period.

Analyze the new data against the existing context and return ONLY a valid JSON object — no markdown, no code fences.

The JSON must have these exact keys:
{
  "properties": {
    "role": "<contact's job title>",
    "company": "<company name>",
    "lastContacted": "<YYYY-MM-DD>"
  },
  "summary": "<concise bulleted summary under 150 words — no fluff>",
  "recommendedActions": ["<action 1>", "<action 2>"],
  "dailyNote": {
    "date": "<YYYY-MM-DD>",
    "title": "<Three Word Description>",
    "summary": "<brief summary of new events>"
  }
}

Rules:
- summary: bullet points, integrate new context naturally, under 150 words
- recommendedActions: remove completed items, add new ones (pricing, demos, follow-ups)
- dailyNote: only for genuinely new activity; set to null if no new data
- Pipeline stage is managed manually by the user — do NOT include a "pipeline" field in your output, ever`;

const BACKFILL_SYSTEM = `You are an expert sales assistant building an initial CRM record from historical communication data.

Return ONLY a valid JSON object — no markdown, no code fences.

{
  "properties": {
    "role": "<contact's job title>",
    "company": "<company name>",
    "lastContacted": "<YYYY-MM-DD>"
  },
  "summary": "<concise bulleted relationship summary under 150 words>",
  "recommendedActions": ["<action 1>", "<action 2>"],
  "dailyNote": null
}

Pipeline stage is managed manually by the user — do NOT include a "pipeline" field in your output, ever.`;

const CHUNK_SYSTEM = `You are a sales analyst. Summarize the relationship activity from the emails and events below as concise bullet notes — key facts only, no fluff. Plain text, no JSON.`;

const COMBINE_SYSTEM = `You are an expert sales assistant. I will give you monthly activity notes for a contact. Combine them into a single CRM record.

Return ONLY a valid JSON object — no markdown, no code fences.

{
  "properties": {
    "role": "<contact's job title>",
    "company": "<company name>",
    "lastContacted": "<YYYY-MM-DD>"
  },
  "summary": "<concise bulleted relationship summary under 150 words>",
  "recommendedActions": ["<action 1>", "<action 2>"],
  "dailyNote": null
}

Pipeline stage is managed manually by the user — do NOT include a "pipeline" field in your output, ever.`;

// ─── Formatters ──────────────────────────────────────────────────────────────

function formatEmails(emails: EmailMessage[]): string {
  if (emails.length === 0) return '(none)';
  return emails
    .map(e => `[${e.date}] From: ${e.from}\nSubject: ${e.subject}\n${e.snippet}`)
    .join('\n---\n');
}

function formatEvents(events: CalendarEvent[]): string {
  if (events.length === 0) return '(none)';
  return events
    .map(e => {
      const lines = [`[${e.start}] ${e.summary}`, `Attendees: ${e.attendees.join(', ')}`];
      if (e.description) lines.push(`Notes: ${e.description}`);
      return lines.join('\n');
    })
    .join('\n---\n');
}

function formatMessages(messages: IMessage[]): string {
  if (messages.length === 0) return '(none)';
  return messages
    .map(m => {
      const ts = m.timestamp.toISOString();
      const sender = m.isFromMe ? 'Me' : 'Them';
      return `[${ts}] ${sender}: ${m.text}`;
    })
    .join('\n');
}

// ─── Month grouping ──────────────────────────────────────────────────────────

function groupByMonth<T>(items: T[], getDate: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const d = new Date(getDate(item));
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

// ─── Gemini call helper ──────────────────────────────────────────────────────

async function callGemini(
  systemInstruction: string,
  userContent: string,
  maxOutputTokens: number
): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: config.geminiModel,
    systemInstruction,
    generationConfig: {
      maxOutputTokens,
      responseMimeType: 'application/json',
    },
  });
  const result = await geminiWithRetry(() => model.generateContent(userContent));
  return result.response.text();
}

// Plain-text variant (no JSON mime) used for chunk summarization
async function callGeminiText(
  systemInstruction: string,
  userContent: string,
  maxOutputTokens: number
): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: config.geminiModel,
    systemInstruction,
    generationConfig: { maxOutputTokens },
  });
  const result = await geminiWithRetry(() => model.generateContent(userContent));
  return result.response.text();
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export async function generateDeltaUpdate(
  contact: Contact,
  currentSummary: string,
  currentActions: string[],
  emails: EmailMessage[],
  events: CalendarEvent[],
  messages: IMessage[] = []
): Promise<LLMResponse> {
  const cappedEmails = capEmails(emails);
  const cappedEvents = capEvents(events);
  const cappedMessages = capMessages(messages);

  const today = new Date().toISOString().split('T')[0];

  const userContent = `Contact: ${contact.name} <${contact.email}>
Company: ${contact.company || 'Unknown'}
Today: ${today}

--- CURRENT SUMMARY ---
${currentSummary || '(none)'}

--- CURRENT RECOMMENDED ACTIONS ---
${currentActions.length > 0 ? currentActions.map(a => `• ${a}`).join('\n') : '(none)'}

--- NEW EMAILS ---
${formatEmails(cappedEmails)}

--- NEW CALENDAR EVENTS ---
${formatEvents(cappedEvents)}

--- NEW IMESSAGES (sanitized: URLs/addresses redacted, capped to ${MAX_MESSAGE_CHARS} chars each) ---
${formatMessages(cappedMessages)}`;

  const text = await callGemini(DELTA_SYSTEM, userContent, 1024);
  return JSON.parse(text) as LLMResponse;
}

export async function generateInitialSummary(
  contact: Contact,
  emails: EmailMessage[],
  events: CalendarEvent[],
  messages: IMessage[] = []
): Promise<LLMResponse> {
  const cappedEmails = capEmails(emails);
  const cappedEvents = capEvents(events);
  const cappedMessages = capMessages(messages);

  if (
    emails.length > cappedEmails.length ||
    events.length > cappedEvents.length ||
    messages.length > cappedMessages.length
  ) {
    console.log(
      `[LLM] Capped backfill data: emails ${emails.length}→${cappedEmails.length}, events ${events.length}→${cappedEvents.length}, messages ${messages.length}→${cappedMessages.length}`
    );
  }

  const today = new Date().toISOString().split('T')[0];
  const header = `Contact: ${contact.name} <${contact.email}>\nCompany: ${contact.company || 'Unknown'}\nToday: ${today}\n\n`;

  const fullData =
    `--- HISTORICAL EMAILS ---\n${formatEmails(cappedEmails)}\n\n` +
    `--- HISTORICAL CALENDAR EVENTS ---\n${formatEvents(cappedEvents)}\n\n` +
    `--- HISTORICAL IMESSAGES (sanitized) ---\n${formatMessages(cappedMessages)}`;

  // Single call if data fits comfortably within free-tier limits
  if ((header + fullData).length <= CHUNK_THRESHOLD) {
    const text = await callGemini(BACKFILL_SYSTEM, header + fullData, 2048);
    return JSON.parse(text) as LLMResponse;
  }

  // ── Chunked path: one Gemini call per month, then a final combine call ──
  console.log(`[LLM] Data exceeds ${CHUNK_THRESHOLD} chars — chunking by month`);

  const emailsByMonth = groupByMonth(cappedEmails, e => e.date);
  const eventsByMonth = groupByMonth(cappedEvents, e => e.start);
  const messagesByMonth = groupByMonth(cappedMessages, m => m.timestamp.toISOString());

  const allMonths = [
    ...new Set([
      ...emailsByMonth.keys(),
      ...eventsByMonth.keys(),
      ...messagesByMonth.keys(),
    ]),
  ].sort();
  const monthlyNotes: string[] = [];

  for (let i = 0; i < allMonths.length; i++) {
    const month = allMonths[i];
    const monthEmails = emailsByMonth.get(month) ?? [];
    const monthEvents = eventsByMonth.get(month) ?? [];
    const monthMessages = messagesByMonth.get(month) ?? [];

    const chunkContent =
      `${header}Month: ${month}\n\n` +
      `Emails:\n${formatEmails(monthEmails)}\n\n` +
      `Calendar Events:\n${formatEvents(monthEvents)}\n\n` +
      `iMessages (sanitized):\n${formatMessages(monthMessages)}`;

    console.log(`[LLM] Chunk ${i + 1}/${allMonths.length}: ${month} (${monthEmails.length} emails, ${monthEvents.length} events, ${monthMessages.length} messages)`);

    const notes = await callGeminiText(CHUNK_SYSTEM, chunkContent, 512);
    monthlyNotes.push(`=== ${month} ===\n${notes.trim()}`);

    // Pause between chunk calls to respect per-minute rate limits
    if (i < allMonths.length - 1) {
      console.log(`[LLM] Waiting ${INTER_CALL_DELAY_MS / 1000}s before next chunk...`);
      await sleep(INTER_CALL_DELAY_MS);
    }
  }

  // Final combine call
  console.log(`[LLM] Combining ${monthlyNotes.length} monthly summaries...`);
  await sleep(INTER_CALL_DELAY_MS);

  const combineContent =
    `${header}Monthly activity notes:\n\n${monthlyNotes.join('\n\n')}`;

  const text = await callGemini(COMBINE_SYSTEM, combineContent, 2048);
  return JSON.parse(text) as LLMResponse;
}
