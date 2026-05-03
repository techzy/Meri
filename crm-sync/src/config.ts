import dotenv from 'dotenv';
dotenv.config();

function require_env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

export const config = {
  geminiApiKey: require_env('GEMINI_API_KEY'),
  notionApiKey: require_env('NOTION_API_KEY'),
  notionDatabaseId: process.env['NOTION_DATABASE_ID'] || '354ccaf9631a802cb6e2dd33befd840b',
  googleClientId: require_env('GOOGLE_CLIENT_ID'),
  googleClientSecret: require_env('GOOGLE_CLIENT_SECRET'),
  googleRefreshToken: require_env('GOOGLE_REFRESH_TOKEN'),
  gmailEmail: require_env('GMAIL_EMAIL'),
  geminiModel: 'gemini-2.0-flash',
  backfillMonths: 3,
  notionRateLimitDelay: 350,
} as const;
