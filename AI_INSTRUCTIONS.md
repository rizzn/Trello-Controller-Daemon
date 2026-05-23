# AI Agent Instructions: Trello Controller Daemon

This file provides context and strict rules for AI agents and LLMs (such as Gemini, Antigravity, Cursor, Cline, etc.) working on or with this codebase.

## 1. Project Overview & Architecture
This repository contains a lightweight, zero-dependency Node.js tool to control Trello boards via CLI or daemon.
- `controller.js`: Main CLI tool. Loads dynamic configuration from `projects.json` (matching `process.cwd()` against `folder_path` defined in board-specific `LOCAL_PROJECTS` objects, or via `TRELLO_BOARD_CONTEXT` env variable) and board settings from `controller.json`.
- `global_runner.js`: The background daemon script. Iterates through all registered Trello board URLs in `projects.json` and runs `sync` followed by `inbox`.
- `run_silent.vbs`: Stealth starter for Windows Task Scheduler.

### Board List Requirements
To work correctly, the target Trello board must have the following list naming conventions:
- **Inbox List:** Configured via `TRELLO_LIST_INCOMING` in `projects.json` (defaults to `"Incoming Tickets"`).
- **Active List:** Configured via `TRELLO_LIST_ACTIVE` in `projects.json` (defaults to `"Active Tickets"`).
- **Completed List:** Configured via `TRELLO_LIST_COMPLETED` in `projects.json` (defaults to `"Completed Tickets"`). If the specified list is not found, the controller falls back to checking list names containing `"implemented"`, `"completed"`, `"complete"`, or `"done"`.

## 2. Execution Paths
When working in a project workspace that is symlinked to the central `.agents` directory:
- **DO NOT** search for a local `.trello` folder.
- Execute all Trello tasks using:
  ```powershell
  node .agents/trello/controller.js [command]
  ```

## 3. Strict Coding & Formatting Standards
When writing, modifying, or creating configuration files (`.json`, `.js`, etc.) in this codebase, you **MUST** follow these rules without exception:
1. **Tabs Only:** Indent all lines with `\t` (tabs), never spaces.
2. **Compact Objects:** Do **not** place spaces after colons in JSON files or JavaScript object declarations.
   - *Correct:* `"TRELLO_KEY":"your_key"`
   - *Incorrect:* `"TRELLO_KEY": "your_key"`
3. **Compact Statements:** Do **not** place spaces after `if`, `for`, `while` keywords and before opening parentheses.
   - *Correct:* `if(condition)`
   - *Incorrect:* `if (condition)`

## 4. Trello Command Quick Reference
AI agents should use these commands to manage cards, track sessions, and maintain board health:

| Command | Usage | Description |
| :--- | :--- | :--- |
| `list` | `node .agents/trello/controller.js list` | Show board lists and cards. |
| `sync` | `node .agents/trello/controller.js sync` | Synchronize board labels & clean card title prefixes board-wide. |
| `inbox` | `node .agents/trello/controller.js inbox` | Process the incoming ticket inbox list. |
| `start` | `node .agents/trello/controller.js start [shortLink]` | Move a card to "Working on" and track the start time. |
| `complete` | `node .agents/trello/controller.js complete [shortLink] "[estTime]"` | Move card to "Implemented", calculate duration, log session. |
| `check-done` | `node .agents/trello/controller.js check-done [shortLink] "[itemName]"` | Mark a checklist item as completed. |
| `backup` | `node .agents/trello/controller.js backup` | Export board state to `board_backup.txt`. |
| `sort` | `node .agents/trello/controller.js sort` | Sort cards in lists based on priorities. |
| `news` | `node .agents/trello/controller.js news [peek]` | Show new/unread tickets across all boards. Use `peek` to list without updating the LAST_CHECKED timestamp. |

## 5. AI Session & Billing Workflow Guidelines
When you, the AI agent, are working on a ticket, you must strictly follow this workflow to document and log your sessions:

1. **Start of Work:**
   - Locate the path defined under `billing_path` inside the matching project object in central `projects.json`.
   - Open that Markdown file and insert an active session row into the sessions table:
     `| [Date] | [StartTime] | *Aktiv* | | | In Arbeit ([Ticket Title]) |`
   - Run the Trello start command:
     `node .agents/trello/controller.js start [shortLink]`
   - **Multiple Tickets:** If working on multiple tickets in one session, list them all in the description column (e.g. `In Arbeit (Ticket A & Ticket B)`) and run the `start` command for each of them.

2. **End of Work / Completion:**
   - Completed cards on Trello are moved to the **"Completed Tickets"** list (or the list configured in `TRELLO_LIST_COMPLETED`). They are **never** archived automatically by this command.
   - Run the `complete` command for the **primary ticket** first:
     `node .agents/trello/controller.js complete [primaryShortLink] "[EstimatedHumanTime]"`
     This will close the active session row in the markdown file and generate the billing line item block.
   - Run the `complete` command for any **remaining tickets** associated with the same session:
     `node .agents/trello/controller.js complete [otherShortLink]`
     This moves those cards to the **"Completed Tickets"** list on Trello. Since the first call already closed the active session row, subsequent calls will complete without duplicating logbook entries.
   - Ensure the generated billing line item matches the formatting rules specified in the project's `billing-rules.md` (e.g., German language, clear customer value, no technical jargon).
