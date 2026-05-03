import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from './config';
import type { Contact, EmailMessage, CalendarEvent, LLMResponse } from './types';

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

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

  const model = genAI.getGenerativeModel({
    model: config.geminiModel,
    systemInstruction: DELTA_SYSTEM,
    generationConfig: {
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
    },
  });

  const result = await model.generateContent(userContent);
  return JSON.parse(result.response.text()) as LLMResponse;
}

export async function generateInitialSummary(
  contact: Contact,
  emails: EmailMessage[],
  events: CalendarEvent[]
): Promise<LLMResponse> {
  const today = new Date().toISOString().split('T')[0];

  const userContent = `Contact: ${contact.name} <${contact.email}>
Company: ${contact.company || 'Unknown'}
Today: ${today}

--- HISTORICAL EMAILS (past ${config.backfillMonths} months) ---
${formatEmails(emails)}

--- HISTORICAL CALENDAR EVENTS (past ${config.backfillMonths} months) ---
${formatEvents(events)}`;

  const model = genAI.getGenerativeModel({
    model: config.geminiModel,
    systemInstruction: BACKFILL_SYSTEM,
    generationConfig: {
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  });

  const result = await model.generateContent(userContent);
  return JSON.parse(result.response.text()) as LLMResponse;
}
