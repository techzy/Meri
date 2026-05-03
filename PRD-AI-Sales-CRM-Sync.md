# Product Requirements Document: AI Sales CRM Sync (v3 - Delta Optimized)

## Context & Objective

You are a senior backend engineer. Your task is to write a Node.js (TypeScript) application that acts as an automated CRM synchronizer. The application will use the provided Notion MCP, Gmail MCP, and Google Calendar MCP.

**CRITICAL ARCHITECTURE RULE:** To minimize LLM token usage and API costs, this system MUST use a "Delta/Rolling State" method. You will not re-read months of old emails every day. You will only fetch new communications since the last sync, combine them with the existing Notion summary, and ask the LLM to update the state.

---

## Immediate First Step for Claude

Before writing any code, you MUST prompt the user to provide the necessary MCP connection details, API keys, and Notion Database IDs required for this script to function. Do not proceed until the user provides this context.

---

## Triggers & Scheduling

The script needs to handle two distinct triggers:

- **New Record Trigger (Initialization):** Poll Notion for new records. When a new contact is added, execute an Initial Backfill.
- **Daily Batch Sync (Delta Update):** Use `node-cron` to run a batch update every day at `0:00` (midnight) to execute Delta Updates for existing contacts.

---

## Notion Database Schema & Page Structure

The script must interact with a Notion Database containing the following properties:

| Property | Type |
|---|---|
| Pipeline | Select/Status |
| Role | Text/Select |
| Last contacted | Date |
| Company | Text/Relation |
| Email | Email |
| Phone | Phone |
| Last Synced | Date/Time — Crucial for the Delta logic |

When creating or updating a contact's Notion Page, construct/update the page content using Notion API Blocks in this exact order:

1. **Heading 1:** "Summary" → **Paragraph:** A comprehensive summary of the entire relationship.
2. **Heading 1:** "Recommended Actions" → **To-Do Blocks (Checkboxes):** A list of actionable next steps.
3. **Heading 1:** "Daily Notes" → **Toggle Blocks:** One toggle per active day (Format: `[Date] - [3-Word High-Level Description]`). Inside the toggle: A concise summary of that day's events.

---

## Core Execution Loop

### Loop 1: Initial Backfill (For NEW Contacts Only)

1. Fetch emails and calendar events from the past 3 months using MCPs.
2. Send this bulk data to the LLM to generate the initial JSON summary, recommended actions, and historical daily notes.
3. Build the Notion page blocks. Set "Last Synced" to the current timestamp.

### Loop 2: Daily Delta Update (For EXISTING Contacts)

1. Check the contact's "Last Synced" timestamp.
2. Fetch emails and calendar events **only** from the "Last Synced" timestamp to the present moment.
3. **Token Saver:** If there are NO new emails or events, SKIP the LLM call entirely and move to the next contact.
4. Fetch the current text under the "Summary" and "Recommended Actions" headings via the Notion API.
5. Pass the current summary, current actions, and the new daily data to the LLM.
6. Use the Notion API to replace the old Summary/Actions blocks with the LLM's updated text, and append a new "Daily Note" toggle block to the bottom of the page. Update "Last Synced".

---

## LLM Summarization Prompt (System Prompt for Delta Updates)

Inject the following prompt (adapted for JSON output) into the LLM API call during daily syncs:

> "You are an expert sales assistant. I am providing you with the CURRENT relationship summary and open action items for a client, along with NEW emails and calendar events from the last 24 hours.
>
> You must analyze the new data against the existing context and return a JSON object containing:
>
> - **Properties updates:** 'Pipeline' status, 'Role', 'Company', and 'Last Contacted' date.
> - An **UPDATED** concise, bulleted 'Summary' of the relationship status (under 150 words). Do not include fluff. Integrate the new context naturally.
> - An **UPDATED** list of 'Recommended Actions'. Remove items that the new data shows are completed. Add new action items, pricing discussions, or next scheduled meetings.
> - A 'Daily Note' for the new data: provide the date, a 3-word high-level description, and a brief summary of the new events. If there is no new data, leave this blank."

---

## Error Handling & Edge Cases (Strict)

- **Idempotency:** When appending new "Daily Notes" toggles, ensure the script does not duplicate existing toggles.
- **Rate Limiting & Retries:** Implement delays between Notion API calls and handle `429 Too Many Requests` errors gracefully with exponential backoff. Do not crash the loop if one contact fails.
