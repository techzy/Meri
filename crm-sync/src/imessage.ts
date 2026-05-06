/**
 * iMessage reader — TypeScript port of imessage-archiver/archiver.py.
 * Opens the macOS Messages chat.db read-only and extracts 1-on-1 messages
 * for a given phone number, decoding the binary `attributedBody` blobs that
 * Apple uses for rich-text storage.
 *
 * Requires Full Disk Access for the running process (e.g. /opt/homebrew/bin/node).
 */

import Database from 'better-sqlite3';
import bplist from 'bplist-parser';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { IMessage } from './types';

const CHAT_DB = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
const APPLE_EPOCH_OFFSET = 978_307_200; // seconds between 1970-01-01 and 2001-01-01

const PLIST_NOISE = new Set([
  '$null', 'NSAttributedString', 'NSMutableAttributedString',
  'NSString', 'NSMutableString', 'NSColor', 'NSFont', 'NSParagraphStyle',
  'NSDictionary', 'NSMutableDictionary', 'NSArray', 'NSMutableArray',
  'NSObject', 'NSValue', 'NSURL', '__kIMFileTransferGUIDAttributeName',
  '__kIMMessagePartAttributeName', '__kIMDataDetectedAttributeName',
  '__kIMLinkAttributeName', '__kIMOneTimeCodeAttributeName',
  'NSUnderlineColor', 'NSUnderlineStyle', 'NSStrikethrough',
  'NSLink', 'NSAttachment', 'com.apple',
]);

const TS_NOISE_PREFIX = /^(?:streamtyped|NS[A-Z]|__k[A-Z]|com\.[a-z]|apple\.|[+@{])/;

// ─── Errors ──────────────────────────────────────────────────────────────────

export class FullDiskAccessRequiredError extends Error {
  constructor(nodePath = process.execPath) {
    super(
      `iMessage reader cannot access ${CHAT_DB}.\n` +
      `Grant Full Disk Access to the running Node binary:\n` +
      `  1. System Settings → Privacy & Security → Full Disk Access\n` +
      `  2. Click "+", add: ${nodePath}\n` +
      `  3. Toggle it ON\n` +
      `  4. Restart the launchd service`
    );
    this.name = 'FullDiskAccessRequiredError';
  }
}

// ─── Phone number normalization ──────────────────────────────────────────────

export function normalizePhone(raw: string): string[] {
  const digits = raw.replace(/\D/g, '');
  const variants = new Set<string>([raw, digits]);
  if (digits.length === 11 && digits.startsWith('1')) {
    variants.add(digits.slice(1));
    variants.add(`+${digits}`);
  } else if (digits.length === 10) {
    variants.add(`+1${digits}`);
    variants.add(`1${digits}`);
  }
  return [...variants].filter(Boolean);
}

// ─── Apple timestamp conversion ──────────────────────────────────────────────

function appleTsToDate(appleTs: number): Date {
  // m.date is nanoseconds-since-2001 on macOS Catalina+, seconds before that
  let secs = appleTs;
  if (secs > 1e12) secs = Math.floor(secs / 1e9);
  return new Date((secs + APPLE_EPOCH_OFFSET) * 1000);
}

function dateToAppleNanos(d: Date): number {
  // Modern chat.db stores nanoseconds; older stored seconds.
  // Multiply by 1e9 to match the modern format; older rows compare fine
  // because their numeric values are all far below the modern range.
  return Math.floor(((d.getTime() / 1000) - APPLE_EPOCH_OFFSET) * 1e9);
}

// ─── attributedBody decoder ──────────────────────────────────────────────────

const BPLIST_HEADER = Buffer.from('bplist');
const TYPEDSTREAM_HEADER = Buffer.from([0x04, 0x0b, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d, 0x74, 0x79, 0x70, 0x65, 0x64]); // \x04\x0bstreamtyped

function decodeAttributedBody(blob: Buffer | null): string | null {
  if (!blob || blob.length === 0) return null;
  if (blob.subarray(0, BPLIST_HEADER.length).equals(BPLIST_HEADER)) {
    return decodeBplist(blob);
  }
  if (blob.subarray(0, TYPEDSTREAM_HEADER.length).equals(TYPEDSTREAM_HEADER)) {
    return decodeTypedstream(blob);
  }
  return null;
}

function decodeBplist(blob: Buffer): string | null {
  try {
    const parsed = bplist.parseBuffer(blob);
    const root = parsed?.[0] as Record<string, unknown> | undefined;
    const objects = root?.['$objects'] as unknown[] | undefined;
    if (!Array.isArray(objects)) return null;

    // Primary path: NSAttributedString dict at index 1 holds a UID ref to the text string
    if (objects.length > 1 && objects[1] && typeof objects[1] === 'object') {
      const dict = objects[1] as Record<string, unknown>;
      const uidRef = dict['NSString'];
      const uid = (uidRef as { UID?: number })?.UID;
      if (typeof uid === 'number' && uid < objects.length) {
        const candidate = objects[uid];
        if (typeof candidate === 'string') return candidate;
      }
    }

    // Fallback: first non-noise string in $objects
    for (let i = 2; i < objects.length; i++) {
      const o = objects[i];
      if (typeof o !== 'string' || !o) continue;
      if (PLIST_NOISE.has(o)) continue;
      if (/^(com\.|public\.|NS|__k)/.test(o)) continue;
      return o;
    }
  } catch {
    // fall through
  }
  return null;
}

function decodeTypedstream(blob: Buffer): string | null {
  // No portable PyObjC equivalent. Heuristic byte-scan: find maximal runs of
  // valid UTF-8 printable text, then pick the longest one that doesn't look
  // like a class/attribute name.
  const candidates: string[] = [];
  const n = blob.length;
  let i = 0;

  while (i < n) {
    let j = i;
    while (j < n) {
      const b = blob[j];
      if ((b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d) {
        j += 1;
      } else if (b >= 0xc2 && b <= 0xdf && j + 1 < n && blob[j + 1] >= 0x80 && blob[j + 1] <= 0xbf) {
        j += 2;
      } else if (b >= 0xe0 && b <= 0xef && j + 2 < n) {
        j += 3;
      } else if (b >= 0xf0 && b <= 0xf4 && j + 3 < n) {
        j += 4;
      } else {
        break;
      }
    }

    if (j > i) {
      try {
        const text = blob.subarray(i, j).toString('utf8');
        if (text.length >= 2) candidates.push(text);
      } catch {
        // skip invalid utf8
      }
      i = j;
    } else {
      i += 1;
    }
  }

  const real = candidates.filter(t => !TS_NOISE_PREFIX.test(t) && /[a-zA-Z]/.test(t));
  if (real.length === 0) return null;

  const withSpaces = real.filter(t => t.includes(' '));
  const pool = withSpaces.length > 0 ? withSpaces : real;
  return pool.reduce((longest, cur) => (cur.length > longest.length ? cur : longest), '');
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getMessagesSince(
  phone: string,
  since: Date,
  until: Date = new Date()
): IMessage[] {
  if (!fs.existsSync(CHAT_DB)) {
    throw new FullDiskAccessRequiredError();
  }

  let db: Database.Database;
  try {
    db = new Database(CHAT_DB, { readonly: true, fileMustExist: true });
    db.prepare('SELECT 1 FROM message LIMIT 1').get(); // permission probe
  } catch {
    throw new FullDiskAccessRequiredError();
  }

  try {
    // 1. Resolve handle ROWIDs for any normalized phone variant
    const candidates = normalizePhone(phone);
    if (candidates.length === 0) return [];

    const handlePlaceholders = candidates.map(() => '?').join(',');
    const handleRows = db
      .prepare(`SELECT ROWID FROM handle WHERE id IN (${handlePlaceholders})`)
      .all(...candidates) as Array<{ ROWID: number }>;

    if (handleRows.length === 0) return [];

    const handleIds = handleRows.map(r => r.ROWID);

    // 2. 1-on-1 messages only — no group-chat clauses
    const idPlaceholders = handleIds.map(() => '?').join(',');
    const sinceNs = dateToAppleNanos(since);
    const untilNs = dateToAppleNanos(until);

    const rows = db
      .prepare(
        `SELECT m.date AS date, m.is_from_me AS is_from_me, m.text AS text, m.attributedBody AS attributedBody
         FROM message m
         WHERE m.handle_id IN (${idPlaceholders})
           AND m.date > ? AND m.date <= ?
         ORDER BY m.date ASC`
      )
      .all(...handleIds, sinceNs, untilNs) as Array<{
        date: number;
        is_from_me: number;
        text: string | null;
        attributedBody: Buffer | null;
      }>;

    return rows.map(r => {
      let body: string | null = decodeAttributedBody(r.attributedBody);
      if (!body && r.text) body = r.text;
      if (!body) body = '[attachment or unsupported content]';
      return {
        timestamp: appleTsToDate(r.date),
        isFromMe: r.is_from_me === 1,
        text: body,
      };
    });
  } finally {
    db.close();
  }
}
