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
- **Daemon Setup:** When initializing a workspace on a Windows system, the agent should automatically run the `install_daemon.ps1` script to ensure that the background daemon task (`TrelloInboxProcessor`) is installed and configured to run every 1 minute:
  ```powershell
  powershell -ExecutionPolicy Bypass -File .agents/trello/install_daemon.ps1
  ```
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
     `| [Date] | [StartTime] | *Active* | | | In Progress ([Ticket Title]) |`
   - Run the Trello start command:
     `node .agents/trello/controller.js start [shortLink]`
   - **Multiple Tickets:** If working on multiple tickets in one session, list them all in the description column (e.g. `In Progress (Ticket A & Ticket B)`) and run the `start` command for each of them.

2. **End of Work / Completion:**
   - Completed cards on Trello are moved to the **"Completed Tickets"** list (or the list configured in `TRELLO_LIST_COMPLETED`). They are **never** archived automatically by this command.
   - Run the `complete` command for the **primary ticket** first:
     `node .agents/trello/controller.js complete [primaryShortLink] "[EstimatedHumanTime]"`
     This will close the active session row in the markdown file and generate the billing line item block.
   - Run the `complete` command for any **remaining tickets** associated with the same session:
     `node .agents/trello/controller.js complete [otherShortLink]`
     This moves those cards to the **"Completed Tickets"** list on Trello. Since the first call already closed the active session row, subsequent calls will complete without duplicating logbook entries.
   - Ensure the generated billing line item matches the formatting rules specified in the project's `billing-rules.md` (e.g., German language, clear customer value, no technical jargon).
## 6. Automatic Ticket Merging & Reopening (Email & Comment Replies)
The daemon automatically merges email replies/updates sent to the board's email address and scans recent board comments to clean up email signatures and handle ticket reopening.
- **Title Normalization:** The daemon strips common email prefixes (`Re:`, `Aw:`, `Fwd:`, `WG:`, etc.) and label prefixes (`[BUG]`, `[FEATURE]`, etc.) to find matching original cards.
- **Email Reply & Comment Cleanup:** To prevent clutter, the daemon automatically cleanses incoming email descriptions and Trello-native comments. It strips out signature blocks, closing salutations (e.g., `Mit freundlichen Grüßen`, `Kind regards`), device signatures (e.g., `Gesendet von meinem iPhone`), and previous conversation history (truncating text below markers like `-----Original Message-----`, `Am ... schrieb`, `On ... wrote:`, `Von:`, `--`, `Gesendet mit`, etc.), ensuring only the new response is posted.
- **Email Sender Extraction:** For new tickets created via email, the daemon locates the automatically attached `.eml` file, extracts the sender's original email address (e.g., `Stephan Riedl <riedl_stephan@outlook.de>`) using authenticated downloads, strips the signature from the card description, and prepends `**Ticket erstellt von:** [Sender]` to the description. For merged tickets, it prepends the sender to the update comment.
- **Auto-Reopen Feature:** If a match is found, or if a user comments on an existing card, and that card has already been archived or moved to the **"Completed Tickets"** list, the daemon automatically restores it (unarchives if needed) and moves it back to the **Inbox** (`Incoming Tickets`).
- **Date Protection Check:** To prevent cards from being falsely reopened when they are manually moved back to Completed Tickets or archived, the daemon compares the comment's creation date against the card's latest move-to-completed or archiving timestamp. It only reopens the card if the comment is strictly newer than the completion move.
- **Merging Action:** If a new email card is matched to an existing one, the cleaned body is added as a comment, attachments are transferred (and embedded), and the duplicate inbox card is deleted.
- **Workflow Benefit:** Users can simply reply to previous emails. Updates will be threaded directly as comments under the corresponding active card. If they reply to a closed ticket, it is automatically resurrected and brought back to the Inbox.

## 7. Global Configuration & Message Templates
The daemon loads label priorities, prefix mappings, and user-facing Trello comments from the global `controller.json` file.
- **Message templates (`messages`):** Customizes comments posted to Trello:
  - `ticketReopened`: Posted when a closed card is reopened by an email reply.
  - `emailUpdateReceived`: Header for incoming merged email comments.
  - `emailContentHeader`: Label for the email text block.
  - `noEmailContent`: Fallback for empty email descriptions.
  - `processingStarted`: Comment posted when starting a card (`start`). Supports the `{timestamp}` placeholder.
  - `processingCompleted`: Comment posted when completing a card (`complete`). Supports `{timestamp}`, `{actual_duration}`, `{estimated_duration}`, and `{duration}` (which defaults to the estimated duration to protect developer efficiency margins).

## 8. Daemon Execution & macOS Support
- **Windows Background Mode:** Run `powershell -ExecutionPolicy Bypass -File install_daemon.ps1` to automatically install or update the `TrelloInboxProcessor` task in Windows Task Scheduler to run the daemon silently every 1 minute. **AI agents should run this command automatically upon workspace initialization on Windows to ensure the daemon is active.**
- **Persistent Listen Mode:** Execute the CLI command `node controller.js listen [interval]` (supports decimal values like `0.5` for a 30-second polling interval).
- **macOS / Linux Support:** On macOS, the daemon can be managed using **PM2** (Process Manager 2) for absolute fault tolerance and automatic restarts:
  `pm2 start "node .agents/trello/controller.js listen 1" --name "trello-daemon"`
  Alternatively, macOS native **Launchd** or **Cron** (`crontab -e`) can be used to run the runner process at scheduled intervals.

