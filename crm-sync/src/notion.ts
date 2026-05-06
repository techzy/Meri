import { Client } from '@notionhq/client';
import type {
  BlockObjectResponse,
  PageObjectResponse,
  RichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { config } from './config';
import type { Contact, LLMResponse, PageContent } from './types';
import { sleep, withRetry } from './utils';

const notion = new Client({ auth: config.notionApiKey });

// ─── Helpers ────────────────────────────────────────────────────────────────

function plainText(richText: RichTextItemResponse[]): string {
  return richText.map(t => t.plain_text).join('');
}

async function getAllPageBlocks(blockId: string): Promise<BlockObjectResponse[]> {
  const blocks: BlockObjectResponse[] = [];
  let cursor: string | undefined;

  do {
    const res = await withRetry(() =>
      notion.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 })
    );
    blocks.push(...(res.results as BlockObjectResponse[]));
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    if (cursor) await sleep(config.notionRateLimitDelay);
  } while (cursor);

  return blocks;
}

// ─── Read contacts ───────────────────────────────────────────────────────────

export async function queryContacts(filter?: 'new' | 'existing'): Promise<Contact[]> {
  const contacts: Contact[] = [];
  let cursor: string | undefined;

  const filterConfig =
    filter === 'new'
      ? { property: 'Last Synced', date: { is_empty: true } }
      : filter === 'existing'
      ? { property: 'Last Synced', date: { is_not_empty: true } }
      : undefined;

  do {
    const res = await withRetry(() =>
      notion.databases.query({
        database_id: config.notionDatabaseId,
        filter: filterConfig as Parameters<typeof notion.databases.query>[0]['filter'],
        start_cursor: cursor,
        page_size: 100,
      })
    );

    for (const page of res.results as PageObjectResponse[]) {
      const p = page.properties;

      const nameProp = p['Name'] ?? p['name'] ?? p['Full Name'];
      const name =
        nameProp?.type === 'title' ? plainText(nameProp.title) : '';

      const email =
        p['Email']?.type === 'email' ? (p['Email'].email ?? '') : '';

      const phone =
        p['Phone']?.type === 'phone_number' ? (p['Phone'].phone_number ?? '') : '';

      const pipeline =
        p['Pipeline']?.type === 'select'
          ? (p['Pipeline'].select?.name ?? '')
          : p['Pipeline']?.type === 'status'
          ? (p['Pipeline'].status?.name ?? '')
          : '';

      const role =
        p['Role']?.type === 'rich_text'
          ? plainText(p['Role'].rich_text)
          : p['Role']?.type === 'select'
          ? (p['Role'].select?.name ?? '')
          : p['Role']?.type === 'multi_select'
          ? p['Role'].multi_select.map(s => s.name).join(', ')
          : '';

      const company =
        p['Company']?.type === 'rich_text'
          ? plainText(p['Company'].rich_text)
          : '';

      const lastContacted =
        p['Last contacted']?.type === 'date'
          ? (p['Last contacted'].date?.start ?? null)
          : null;

      const lastSynced =
        p['Last Synced']?.type === 'date'
          ? (p['Last Synced'].date?.start ?? null)
          : null;

      contacts.push({ pageId: page.id, name, email, phone, pipeline, role, company, lastContacted, lastSynced });
    }

    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    if (cursor) await sleep(config.notionRateLimitDelay);
  } while (cursor);

  return contacts;
}

// ─── Read page block content ─────────────────────────────────────────────────

export async function getPageContent(pageId: string): Promise<PageContent> {
  const blocks = await getAllPageBlocks(pageId);

  const content: PageContent = {
    summaryBlockId: null,
    summaryText: '',
    actionsHeadingId: null,
    actionBlocks: [],
    dailyNotesHeadingId: null,
    dailyNoteDates: [],
  };

  type Section = 'none' | 'summary' | 'actions' | 'dailyNotes';
  let section: Section = 'none';
  let summaryParagraphFound = false;

  for (const block of blocks) {
    if (block.type === 'heading_1') {
      const text = plainText((block as BlockObjectResponse & { heading_1: { rich_text: RichTextItemResponse[] } }).heading_1.rich_text);
      if (text === 'Summary') {
        section = 'summary';
      } else if (text === 'Recommended Actions') {
        section = 'actions';
        content.actionsHeadingId = block.id;
      } else if (text === 'Daily Notes') {
        section = 'dailyNotes';
        content.dailyNotesHeadingId = block.id;
      } else {
        section = 'none';
      }
      continue;
    }

    if (section === 'summary' && block.type === 'paragraph' && !summaryParagraphFound) {
      const b = block as BlockObjectResponse & { paragraph: { rich_text: RichTextItemResponse[] } };
      content.summaryBlockId = block.id;
      content.summaryText = plainText(b.paragraph.rich_text);
      summaryParagraphFound = true;
    } else if (section === 'actions' && block.type === 'to_do') {
      const b = block as BlockObjectResponse & { to_do: { rich_text: RichTextItemResponse[]; checked: boolean } };
      content.actionBlocks.push({
        id: block.id,
        text: plainText(b.to_do.rich_text),
        checked: b.to_do.checked,
      });
    } else if (section === 'dailyNotes' && block.type === 'toggle') {
      const b = block as BlockObjectResponse & { toggle: { rich_text: RichTextItemResponse[] } };
      const toggleText = plainText(b.toggle.rich_text);
      const dateMatch = toggleText.match(/^(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        content.dailyNoteDates.push(dateMatch[1]);
      }
    }
  }

  return content;
}

// ─── Build initial page blocks ───────────────────────────────────────────────

function buildInitialBlocks(llm: LLMResponse): object[] {
  const blocks: object[] = [
    { type: 'heading_1', heading_1: { rich_text: [{ type: 'text', text: { content: 'Summary' } }] } },
    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: llm.summary } }] } },
    { type: 'heading_1', heading_1: { rich_text: [{ type: 'text', text: { content: 'Recommended Actions' } }] } },
    ...llm.recommendedActions.map(action => ({
      type: 'to_do',
      to_do: { rich_text: [{ type: 'text', text: { content: action } }], checked: false },
    })),
    { type: 'heading_1', heading_1: { rich_text: [{ type: 'text', text: { content: 'Daily Notes' } }] } },
  ];

  if (llm.dailyNote?.summary) {
    blocks.push(buildToggleBlock(llm.dailyNote.date, llm.dailyNote.title, llm.dailyNote.summary));
  }

  return blocks;
}

function buildToggleBlock(date: string, title: string, summary: string): object {
  return {
    type: 'toggle',
    toggle: {
      rich_text: [{ type: 'text', text: { content: `${date} - ${title}` } }],
      children: [
        { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: summary } }] } },
      ],
    },
  };
}

// ─── Write operations ────────────────────────────────────────────────────────

export async function createPageContent(pageId: string, llm: LLMResponse): Promise<void> {
  await withRetry(() =>
    notion.blocks.children.append({ block_id: pageId, children: buildInitialBlocks(llm) as Parameters<typeof notion.blocks.children.append>[0]['children'] })
  );
  await sleep(config.notionRateLimitDelay);
}

export async function updatePageContent(
  pageId: string,
  existing: PageContent,
  llm: LLMResponse
): Promise<void> {
  // 1. Update Summary paragraph in place
  if (existing.summaryBlockId) {
    await withRetry(() =>
      notion.blocks.update({
        block_id: existing.summaryBlockId!,
        paragraph: { rich_text: [{ type: 'text', text: { content: llm.summary } }] },
      } as Parameters<typeof notion.blocks.update>[0])
    );
    await sleep(config.notionRateLimitDelay);
  }

  // 2. Delete stale todo blocks
  for (const block of existing.actionBlocks) {
    await withRetry(() => notion.blocks.delete({ block_id: block.id }));
    await sleep(config.notionRateLimitDelay);
  }

  // 3. Re-insert updated todos directly after the Recommended Actions heading
  if (llm.recommendedActions.length > 0 && existing.actionsHeadingId) {
    await withRetry(() =>
      notion.blocks.children.append({
        block_id: pageId,
        after: existing.actionsHeadingId!,
        children: llm.recommendedActions.map(action => ({
          type: 'to_do' as const,
          to_do: { rich_text: [{ type: 'text', text: { content: action } }], checked: false },
        })),
      })
    );
    await sleep(config.notionRateLimitDelay);
  }

  // 4. Append Daily Note toggle — skip if date already exists (idempotency)
  if (llm.dailyNote?.date && llm.dailyNote?.summary) {
    if (!existing.dailyNoteDates.includes(llm.dailyNote.date)) {
      await withRetry(() =>
        notion.blocks.children.append({
          block_id: pageId,
          children: [buildToggleBlock(llm.dailyNote!.date, llm.dailyNote!.title, llm.dailyNote!.summary)] as Parameters<typeof notion.blocks.children.append>[0]['children'],
        })
      );
      await sleep(config.notionRateLimitDelay);
    }
  }
}

export async function updateProperties(
  pageId: string,
  props: LLMResponse['properties'],
  lastSynced: string
): Promise<void> {
  const properties: Record<string, unknown> = {
    'Last Synced': { date: { start: lastSynced } },
  };

  if (props.pipeline) properties['Pipeline'] = { select: { name: props.pipeline } };
  if (props.role) {
    // Role is a multi_select in this database — split comma-separated values into options
    const roleOptions = props.role
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(name => ({ name }));
    properties['Role'] = { multi_select: roleOptions };
  }
  if (props.lastContacted) properties['Last contacted'] = { date: { start: props.lastContacted } };

  await withRetry(() =>
    notion.pages.update({ page_id: pageId, properties: properties as Parameters<typeof notion.pages.update>[0]['properties'] })
  );
  await sleep(config.notionRateLimitDelay);
}
