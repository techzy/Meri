import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from './config';
import { geminiWithRetry, sleep } from './utils';
import type { Contact, EmailMessage, CalendarEvent, LLMResponse } from './types';

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

// Character length above which we chunk the backfill month-by-month
const CHUNK_THRESHOLD = 15_000;
// Delay between consecutive Gemini calls to stay under free-tier RPM limits
const INTER_CALL_DELAY_MS = 15_000;

// ─── System prompts ──────────────────────────────────────────────────────────

const DELTA_SYSTEM = `You are an expert sales assistant. I am providing you with the CURRENT relationship summary and open action items for a client, along with NEW emails and calendar events from the last sync period.

Analyze the new data against the existing context and return ONLY a valid JSON object — no markdown, no code fences.

The JSON must have these exact keys:
{
  "properties": {
    "pipeline": "<stage name>",
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
- dailyNote: only for genuinely new activity; set to null if no new data`;

const BACKFILL_SYSTEM = `You are an expert sales assistant building an initial CRM record from historical communication data.

Return ONLY a valid JSON object — no markdown, no code fences.

{
  "properties": {
    "pipeline": "<stage name>",
    "role": "<contact's job title>",
    "company": "<company name>",
    "lastContacted": "<YYYY-MM-DD>"
  },
  "summary": "<concise bulleted relationship summary under 150 words>",
  "recommendedActions": ["<action 1>", "<action 2>"],
  "dailyNote": null
}`;

const CHUNK_SYSTEM = `You are a sales analyst. Summarize the relationship activity from the emails and events below as concise bullet notes — key facts only, no fluff. Plain text, no JSON.`;

const COMBINE_SYSTEM = `You are an expert sales assistant. I will give you monthly activity notes for a contact. Combine them into a single CRM record.

Return ONLY a valid JSON object — no markdown, no code fences.

{
  "properties": {
    "pipeline": "<stage name>",
    "role": "<contact's job title>",
    "company": "<company name>",
    "lastContacted": "<YYYY-MM-DD>"
  },
  "summary": "<concise bulleted relationship summary under 150 words>",
  "recommendedActions": ["<action 1>", "<action 2>"],
  "dailyNote": null
}`;

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
  events: CalendarEvent[]
): Promise<LLMResponse> {
  const today = new Date().toISOString().split('T')[0];

  const userContent = `Contact: ${contact.name} <${contact.email}>
Company: ${contact.company || 'Unknown'}
Today: ${today}

--- CURRENT SUMMARY ---
${currentSummary || '(none)'}

--- CURRENT RECOMMENDED ACTIONS ---
${currentActions.length > 0 ? currentActions.map(a => `• ${a}`).join('\n') : '(none)'}

--- NEW EMAILS ---
${formatEmails(emails)}

--- NEW CALENDAR EVENTS ---
${formatEvents(events)}`;

  const text = await callGemini(DELTA_SYSTEM, userContent, 1024);
  return JSON.parse(text) as LLMResponse;
}

export async function generateInitialSummary(
  contact: Contact,
  emails: EmailMessage[],
  events: CalendarEvent[]
): Promise<LLMResponse> {
  const today = new Date().toISOString().split('T')[0];
  const header = `Contact: ${contact.name} <${contact.email}>\nCompany: ${contact.company || 'Unknown'}\nToday: ${today}\n\n`;

  const fullData =
    `--- HISTORICAL EMAILS ---\n${formatEmails(emails)}\n\n` +
    `--- HISTORICAL CALENDAR EVENTS ---\n${formatEvents(events)}`;

  // Single call if data fits comfortably within free-tier limits
  if ((header + fullData).length <= CHUNK_THRESHOLD) {
    const text = await callGemini(BACKFILL_SYSTEM, header + fullData, 2048);
    return JSON.parse(text) as LLMResponse;
  }

  // ── Chunked path: one Gemini call per month, then a final combine call ──
  console.log(`[LLM] Data exceeds ${CHUNK_THRESHOLD} chars — chunking by month`);

  const emailsByMonth = groupByMonth(emails, e => e.date);
  const eventsByMonth = groupByMonth(events, e => e.start);

  const allMonths = [...new Set([...emailsByMonth.keys(), ...eventsByMonth.keys()])].sort();
  const monthlyNotes: string[] = [];

  for (let i = 0; i < allMonths.length; i++) {
    const month = allMonths[i];
    const monthEmails = emailsByMonth.get(month) ?? [];
    const monthEvents = eventsByMonth.get(month) ?? [];

    const chunkContent =
      `${header}Month: ${month}\n\n` +
      `Emails:\n${formatEmails(monthEmails)}\n\n` +
      `Calendar Events:\n${formatEvents(monthEvents)}`;

    console.log(`[LLM] Chunk ${i + 1}/${allMonths.length}: ${month} (${monthEmails.length} emails, ${monthEvents.length} events)`);

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
