# AI Agent Instructions: Trello Controller Daemon

This file provides context and strict rules for AI agents and LLMs (such as Gemini, Antigravity, Cursor, Cline, etc.) working with or on this codebase.

## 1. Project Overview & Architecture
This repository contains a lightweight, zero-dependency Node.js tool to control Trello boards via CLI or daemon.
- [`controller.js`](controller.js): Main CLI tool. Loads dynamic configuration from `projects.json` (matching `process.cwd()` against `folder_path` defined in board-specific `LOCAL_PROJECTS` objects, or falling back to the base directory name if the exact path differs—ideal for Desktop/Laptop synchronization. It also matches the `billing_path` with a fallback search in the relative `.agents/billing/` directory if the absolute path does not exist). Board settings are loaded from [`controller.json`](controller.json).
- [`global_runner.js`](global_runner.js): The background daemon script. Iterates through all registered Trello board URLs in `projects.json` and runs `sync` followed by `inbox`.
- [`run_silent.vbs`](run_silent.vbs): Stealth starter for Windows Task Scheduler.

### Board List Requirements
To work correctly, the target Trello board must have the following list naming conventions:
- **Inbox List:** Configured via `TRELLO_LIST_INCOMING` in `projects.json` (defaults to `"Incoming Tickets"`).
- **Active List:** Configured via `TRELLO_LIST_ACTIVE` in `projects.json` (defaults to `"Active Tickets"`).
- **Completed List:** Configured via `TRELLO_LIST_COMPLETED` in `projects.json` (defaults to `"Completed Tickets"`). If the specified list is not found, the controller falls back to checking list names containing `"implemented"`, `"completed"`, `"complete"`, or `"done"`.

## 2. Execution Paths
When working in a project workspace that is symlinked to the central `.agents` directory:
- **Single source of truth:** Project configurations and board mappings live exclusively in `projects.json` (git-ignored, holds the credentials). No local `.trello` directory exists or should be inspected.
- **Daemon Setup:** When initializing a workspace on a Windows system, the agent should automatically run the [`install_daemon.ps1`](install_daemon.ps1) script to ensure that the background daemon task (`TrelloInboxProcessor`) is installed and configured to poll every 10 seconds (running a 10-second loop inside a 1-minute task interval):
  ```powershell
  powershell -ExecutionPolicy Bypass -File .agents/tools/trello/install_daemon.ps1
  ```
- Execute all Trello tasks using:
  ```powershell
  node .agents/tools/trello/controller.js [command]
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
4. **Standard Operator Spacing:** Always place spaces around assignment, comparison, and mathematical operators (`=`, `===`, `!==`, `+`, `-`, `*`, `/`, etc.). Do **not** format them compactly.
   - *Correct:* `const x = 5;`
   - *Incorrect:* `const x=5;`

## 4. Trello Command Quick Reference
AI agents should use these commands to manage cards, track sessions, and maintain board health:

| Command | Usage | Description |
| :--- | :--- | :--- |
| `list` | `node .agents/tools/trello/controller.js list` | Show board lists and cards. |
| `add` | `node .agents/tools/trello/controller.js add "Title" ["Desc"] ["ListName"]` | Create a new card with automatic label assignment. |
| `move` | `node .agents/tools/trello/controller.js move [shortLink] "ListName"` | Move a card to another list. |
| `start` | `node .agents/tools/trello/controller.js start [shortLink]` | Move a card to "Active Tickets", track start time, create local `active_ticket.json`. |
| `complete` | `node .agents/tools/trello/controller.js complete [shortLink] "[estTime]"` | Move card to "Completed Tickets", calculate actual time, log billing session. |
| `check` | `node .agents/tools/trello/controller.js check [shortLink] "ItemName"` | Add a checklist item to a card. |
| `check-done` | `node .agents/tools/trello/controller.js check-done [shortLink] "ItemName"` | Mark a checklist item as completed and update local JSON. |
| `label` | `node .agents/tools/trello/controller.js label [shortLink] [Color] ["LabelName"]` | Add a label to a card. |
| `comment` | `node .agents/tools/trello/controller.js comment [shortLink] "Text"` | Add a comment to a card. |
| `archive` | `node .agents/tools/trello/controller.js archive [shortLink]` | Archive a card. |
| `delete` | `node .agents/tools/trello/controller.js delete [shortLink]` | Permanently delete a card. |
| `search` | `node .agents/tools/trello/controller.js search "Query"` | Search for cards on the board. |
| `inbox` | `node .agents/tools/trello/controller.js inbox` | Run manual incoming ticket & email merging logic. |
| `sync` | `node .agents/tools/trello/controller.js sync` | Synchronize board labels & clean card title prefixes board-wide. |
| `listen` | `node .agents/tools/trello/controller.js listen [intervalMinutes]` | Start the persistent inbox polling daemon in the foreground. |
| `news` / `unread` | `node .agents/tools/trello/controller.js news [peek]` | Show new/unread tickets across all boards. Use `peek` to list without updating LAST_CHECKED. |
| `status` | `node .agents/tools/trello/controller.js status` | Display the status of the background daemon process and scheduled task. |
| `projects` | `node .agents/tools/trello/controller.js projects` | List registered projects, paths, and `.agents` symlink status. |
| `backup` | `node .agents/tools/trello/controller.js backup` | Export the current board layout to `board_backup.txt`. |
| `sort` | `node .agents/tools/trello/controller.js sort` | Sort cards in lists based on priorities. |

## 5. AI Session & Billing Workflow Guidelines
When you, the AI agent, are working on a ticket, you must strictly follow this workflow to document and log your sessions:

1. **Start of Work:**
   - Locate the path defined under `billing_path` inside the matching project object in central `projects.json`.
   - Open that Markdown file and insert an active session row into the sessions table:
     `| [Date] | [StartTime] | *Active* | | | In Progress ([Ticket Title]) |`
   - Run the Trello start command:
     `node .agents/tools/trello/controller.js start [shortLink]`
   - **Multiple Tickets:** If working on multiple tickets in one session, list them all in the description column (e.g. `In Progress (Ticket A & Ticket B)`) and run the `start` command for each of them.

2. **End of Work / Completion:**
   - Completed cards on Trello are moved to the **"Completed Tickets"** list (or the list configured in `TRELLO_LIST_COMPLETED`). They are **never** archived automatically by this command.
   - Run the `complete` command for the **primary ticket** first:
     `node .agents/tools/trello/controller.js complete [primaryShortLink] "[EstimatedHumanTime]"`
     This will close the active session row in the markdown file and generate the billing line item block.
   - Run the `complete` command for any **remaining tickets** associated with the same session:
     `node .agents/tools/trello/controller.js complete [otherShortLink]`
     This moves those cards to the **"Completed Tickets"** list on Trello. Since the first call already closed the active session row, subsequent calls will complete without duplicating logbook entries.
   - Ensure the generated billing line item matches the formatting rules specified in `.agents/rules/billing-rules.md` (e.g., German language, clear customer value, no technical jargon).
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
The daemon loads label priorities, prefix mappings, and user-facing Trello comments from the global [`controller.json`](controller.json) file.
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
  `pm2 start "node .agents/tools/trello/controller.js listen 1" --name "trello-daemon"`
  Alternatively, macOS native **Launchd** or **Cron** (`crontab -e`) can be used to run the runner process at scheduled intervals.


## 9. Portable Paths
- `folder_path` in `projects.json` never contains a drive letter. Supported tokens: `%VAR%`, `${VAR}`, `~` and the built-in `%AGENTS_ROOT%` (the central `.agents` folder). Example: `"folder_path": "%HTDOCS%/pec"`.
- Token values are defined at the top of `projects.json` in `PATH_VARS`: a hostname key (`os.hostname()`, e.g. `DESKTOP-OQQVOEP`) per machine, optional `"*"` for all machines. Drive letters live only there. Precedence: host block > `"*"` > process environment > built-in `AGENTS_ROOT`. Values may use tokens themselves (`"%AGENTS_ROOT%/../htdocs"`).
- If a token cannot be resolved, matching falls back to the last path segment against the current folder name (`pec`), so running from inside the project always works.
- `billing_path` uses the `%BILLING_PATH%` token (`"%BILLING_PATH%/billing-log-pec.md"`), defined in the `"*"` block of `PATH_VARS` as `%AGENTS_ROOT%/billing`; `-` disables billing. A bare file name or an unresolvable path falls back to `.agents/billing/<file name>`.
- Resolution lives in [`paths.js`](paths.js); regression tests: `node --test ".agents/tools/trello/.tests/*.test.js"`.

## 10. Autopilot (Trello -> headless agent -> billing -> Telegram)
[`autopilot.js`](autopilot.js) processes exactly one card per run:
1. Resolves the project via `--board <project|board>` or the current folder, then the workspace root (see section 9).
2. Aborts if `active_ticket.json` exists in the root (running session or unresolved roadblock) or if tracked files are uncommitted.
3. Picks the top card in the Incoming list carrying the gate label (`autopilot.label` in `controller.json`, default `Autopilot`). Cards created by email are never processed without that label. `--card <shortLink> --approve` attaches the label as explicit approval (used by Telegram `/go`).
4. Opens a `*Active*` row in the billing log (if billing is active), runs `controller.js start`.
5. Pipes the ticket to the agent CLI (`autopilot.agentCommand` / `agentArgs`; default `claude -p` with Read/Edit/Write/Glob/Grep only, no Bash) via stdin.
6. Runs `npm test` / `npm run lint` if defined in the project `package.json`, collects `git diff --shortstat` against the base hash. It never commits.
7. Success: `controller.js complete` (card -> Completed, billing row closed, Rechnungsposition appended). Roadblock: card stays in Active, `active_ticket.json` stays as lock, the billing row is removed (no billing for failed runs).
8. Reports via `node .agents/tools/telegram/controller.js send <NOTIFY_CHAT_ID>`; a summary is also posted as Trello comment.

```powershell
node .agents/tools/trello/autopilot.js --dry-run
node .agents/tools/trello/autopilot.js --board pec-website
node .agents/tools/trello/autopilot.js --board pec-website --card AbCd1234 --approve
```
