import { google } from 'googleapis';
import { config } from './config';
import type { CalendarEvent } from './types';

function createAuth() {
  const auth = new google.auth.OAuth2(config.googleClientId, config.googleClientSecret);
  auth.setCredentials({ refresh_token: config.googleRefreshToken });
  return auth;
}

export async function getEventsSince(
  contactEmail: string,
  since: Date,
  until: Date = new Date()
): Promise<CalendarEvent[]> {
  const calendar = google.calendar({ version: 'v3', auth: createAuth() });

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: since.toISOString(),
    timeMax: until.toISOString(),
    maxResults: 250,
    singleEvents: true,
    orderBy: 'startTime',
    // q filters by attendee email, summary, description
    q: contactEmail,
  });

  const items = res.data.items ?? [];
  const lowerEmail = contactEmail.toLowerCase();

  return items
    .filter(event => {
      // Double-check the contact is actually an attendee (q is a fuzzy search)
      const attendees = event.attendees?.map(a => a.email?.toLowerCase()) ?? [];
      return attendees.includes(lowerEmail);
    })
    .map(event => ({
      id: event.id!,
      summary: event.summary ?? '(No title)',
      start: event.start?.dateTime ?? event.start?.date ?? '',
      end: event.end?.dateTime ?? event.end?.date ?? '',
      attendees: (event.attendees ?? []).map(a => a.email ?? '').filter(Boolean),
      description: event.description ?? undefined,
    }));
}
