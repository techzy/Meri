import { google } from 'googleapis';
import { config } from './config';
import type { EmailMessage } from './types';

function createAuth() {
  const auth = new google.auth.OAuth2(config.googleClientId, config.googleClientSecret);
  auth.setCredentials({ refresh_token: config.googleRefreshToken });
  return auth;
}

export async function getEmailsSince(
  contactEmail: string,
  since: Date,
  until: Date = new Date()
): Promise<EmailMessage[]> {
  const gmail = google.gmail({ version: 'v1', auth: createAuth() });

  // Gmail search uses Unix timestamps
  const sinceUnix = Math.floor(since.getTime() / 1000);
  const untilUnix = Math.floor(until.getTime() / 1000);
  const query = `(from:${contactEmail} OR to:${contactEmail}) after:${sinceUnix} before:${untilUnix}`;

  const messages: EmailMessage[] = [];
  let pageToken: string | undefined;

  do {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 100,
      pageToken,
    });

    const items = listRes.data.messages ?? [];

    await Promise.all(
      items.map(async msg => {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        });

        const headers = detail.data.payload?.headers ?? [];
        const h = (name: string) => headers.find(x => x.name === name)?.value ?? '';

        messages.push({
          id: msg.id!,
          date: h('Date'),
          from: h('From'),
          to: h('To'),
          subject: h('Subject'),
          snippet: detail.data.snippet ?? '',
        });
      })
    );

    pageToken = listRes.data.nextPageToken ?? undefined;
  } while (pageToken);

  return messages;
}
