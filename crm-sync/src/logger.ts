import fs from 'fs';
import path from 'path';

// Logs directory sits next to the compiled output (dist/) and source (src/),
// at the project root: <project>/logs/MM-DD-YYYY.log
const LOG_DIR = path.join(__dirname, '..', 'logs');

function todayFilename(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}-${dd}-${yyyy}.log`;
}

function format(level: string, args: unknown[]): string {
  const ts = new Date().toISOString();
  const text = args
    .map(a => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack ?? a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  return `[${ts}] [${level}] ${text}\n`;
}

function writeLine(level: string, args: unknown[]): void {
  try {
    fs.appendFileSync(path.join(LOG_DIR, todayFilename()), format(level, args));
  } catch {
    // Never let a logging error crash the app
  }
}

/**
 * Patches console.log / console.warn / console.error so every line is also
 * appended to logs/MM-DD-YYYY.log. The filename is computed per-write, so the
 * file rolls over automatically at midnight without restarting the process.
 *
 * Original console output is preserved — useful for `npm run dev` and for
 * launchd's stdout/stderr capture.
 */
export function setupDailyFileLogging(): void {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: unknown[]) => {
    origLog(...args);
    writeLine('INFO', args);
  };
  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    writeLine('WARN', args);
  };
  console.error = (...args: unknown[]) => {
    origError(...args);
    writeLine('ERROR', args);
  };
}
