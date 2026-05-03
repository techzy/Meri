export interface Contact {
  pageId: string;
  name: string;
  email: string;
  phone: string;
  pipeline: string;
  role: string;
  company: string;
  lastContacted: string | null;
  lastSynced: string | null;
}

export interface LLMResponse {
  properties: {
    pipeline: string;
    role: string;
    company: string;
    lastContacted: string;
  };
  summary: string;
  recommendedActions: string[];
  dailyNote?: {
    date: string;
    title: string;
    summary: string;
  } | null;
}

export interface EmailMessage {
  id: string;
  date: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  attendees: string[];
  description?: string;
}

export interface PageContent {
  summaryBlockId: string | null;
  summaryText: string;
  actionsHeadingId: string | null;
  actionBlocks: Array<{ id: string; text: string; checked: boolean }>;
  dailyNotesHeadingId: string | null;
  dailyNoteDates: string[];
}
