# AI Agent Instructions: Trello Controller Daemon

This file provides context and strict rules for AI agents and LLMs (such as Gemini, Antigravity, Cursor, Cline, etc.) working with or on this codebase.

## 1. Project Overview & Architecture
This repository contains a lightweight, zero-dependency Node.js tool to control Trello boards via CLI or daemon.
- [`controller.js`](controller.js): Main CLI tool. Loads dynamic configuration from `projects.json` (matching `process.cwd()` against `folder_path` defined in board-specific `LOCAL_PROJECTS` objects, or falling back to the base directory name if the exact path differs—ideal for Desktop/Laptop synchronization). Board settings are loaded from [`controller.json`](controller.json).
- [`global_runner.js`](global_runner.js): The background daemon script. Iterates through all registered Trello board URLs in `projects.json` and runs `sync` followed by `inbox`.
- [`autopilot.js`](autopilot.js): Hands one approved card to a headless agent (section 10).
- [`paths.js`](paths.js): Path tokens, project lookup by working directory, optional billing hook `BILLING_MODULE` (sections 9 and 10).
- [`run_silent.vbs`](run_silent.vbs): Stealth starter for Windows Task Scheduler.

### Board List Requirements
To work correctly, the target Trello board must have the following list naming conventions:
- **Inbox List:** Configured via `TRELLO_LIST_INCOMING` in `projects.json` (defaults to `"Incoming Tickets"`).
- **Active List:** Configured via `TRELLO_LIST_ACTIVE` in `projects.json` (defaults to `"Active Tickets"`).
- **Completed List:** Configured via `TRELLO_LIST_COMPLETED` in `projects.json` (defaults to `"Completed Tickets"`). If the specified list is not found, the controller falls back to checking list names containing `"implemented"`, `"completed"`, `"complete"`, or `"done"`.

## 2. Execution Paths
`<trello-dir>` in every command is the folder containing this file. The tool runs from any location and needs no sibling tools. Run every command from inside the project folder, the working directory selects the project:
- **Single source of truth:** Project configurations and board mappings live exclusively in `projects.json` (git-ignored, holds the credentials). No local `.trello` directory exists or should be inspected.
- **Daemon Setup:** When initializing a workspace on a Windows system, the agent should automatically run the [`install_daemon.ps1`](install_daemon.ps1) script to ensure that the background daemon task (`TrelloInboxProcessor`) is installed and configured to poll every 10 seconds (running a 10-second loop inside a 1-minute task interval):
  ```powershell
  powershell -ExecutionPolicy Bypass -File <trello-dir>/install_daemon.ps1
  ```
- Execute all Trello tasks using:
  ```powershell
  node <trello-dir>/controller.js [command]
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
| `list` | `node <trello-dir>/controller.js list` | Show board lists and cards. |
| `add` | `node <trello-dir>/controller.js add "Title" ["Desc"] ["ListName"]` | Create a new card with automatic label assignment. Without `ListName` it lands in the inbox (`TRELLO_LIST_INCOMING`). |
| `desc` | `node <trello-dir>/controller.js desc [shortLink] "Description"` | Replace a card's description. |
| `move` | `node <trello-dir>/controller.js move [shortLink] "ListName"` | Move a card to another list. |
| `start` | `node <trello-dir>/controller.js start [shortLink]` | Move a card to "Active Tickets", track start time, create local `active_ticket.json`. |
| `complete` | `node <trello-dir>/controller.js complete [shortLink] "[estTime]"` | Move card to "Completed Tickets", post actual/estimated time (from `active_ticket.json`) as a comment. |
| `check` | `node <trello-dir>/controller.js check [shortLink] "ItemName"` | Add a checklist item to a card. |
| `check-done` | `node <trello-dir>/controller.js check-done [shortLink] "ItemName"` | Mark a checklist item as completed and update local JSON. |
| `label` | `node <trello-dir>/controller.js label [shortLink] [Color] ["LabelName"]` | Add a label to a card. |
| `comment` | `node <trello-dir>/controller.js comment [shortLink] "Text"` | Add a comment to a card. |
| `archive` | `node <trello-dir>/controller.js archive [shortLink]` | Archive a card. |
| `delete` | `node <trello-dir>/controller.js delete [shortLink]` | Permanently delete a card. |
| `search` | `node <trello-dir>/controller.js search "Query"` | Search for cards on the board. |
| `inbox` | `node <trello-dir>/controller.js inbox` | Run manual incoming ticket & email merging logic. |
| `sync` | `node <trello-dir>/controller.js sync` | Synchronize board labels & clean card title prefixes board-wide. |
| `listen` | `node <trello-dir>/controller.js listen [intervalMinutes]` | Start the persistent inbox polling daemon in the foreground. |
| `news` / `unread` | `node <trello-dir>/controller.js news [peek]` | Show new/unread tickets across all boards. Use `peek` to list without updating LAST_CHECKED. |
| `status` | `node <trello-dir>/controller.js status` | Display the status of the background daemon process and scheduled task. |
| `projects` | `node <trello-dir>/controller.js projects` | List registered projects and whether their folders exist on this machine. |
| `backup` | `node <trello-dir>/controller.js backup` | Export the current board layout to `board_backup.txt`. |
| `sort` | `node <trello-dir>/controller.js sort` | Sort cards in lists based on priorities. |

## 5. AI Session Workflow Guidelines
When you, the AI agent, are working on a ticket, follow this workflow.

1. **Start of Work:**
   - Run the Trello start command:
     `node <trello-dir>/controller.js start [shortLink]`
     It moves the card to "Active Tickets" and writes `active_ticket.json` (including `startedAtIso`).
   - **Multiple Tickets:** If working on multiple tickets in one session, run the `start` command for each of them.

2. **End of Work / Completion:**
   - Completed cards on Trello are moved to the **"Completed Tickets"** list (or the list configured in `TRELLO_LIST_COMPLETED`). They are **never** archived automatically by this command.
   - Run the `complete` command for every ticket of the session:
     `node <trello-dir>/controller.js complete [shortLink] "[EstimatedHumanTime]"`
     For the card stored in `active_ticket.json` it posts the actual and estimated duration as a comment; other cards are only moved. Without `EstimatedHumanTime` the estimate equals the actual time.
   - Session billing is not part of this tool; it belongs to the agent setup. Only the autopilot has an optional billing hook (`BILLING_MODULE`, section 10).

## 6. Automatic Ticket Merging & Reopening (Email & Comment Replies)
The daemon automatically merges email replies/updates sent to the board's email address and scans recent board comments to clean up email signatures and handle ticket reopening.
- **Title Normalization:** The daemon strips common email prefixes (`Re:`, `Aw:`, `Fwd:`, `WG:`, etc.) and label prefixes (`[BUG]`, `[FEATURE]`, etc.) to find matching original cards.
- **Email Reply & Comment Cleanup:** To prevent clutter, the daemon automatically cleanses incoming email descriptions and Trello-native comments. It strips out signature blocks, closing salutations (e.g., `Mit freundlichen Grüßen`, `Kind regards`), device signatures (e.g., `Gesendet von meinem iPhone`), and previous conversation history (truncating text below markers like `-----Original Message-----`, `Am ... schrieb`, `On ... wrote:`, `Von:`, `--`, `Gesendet mit`, etc.), ensuring only the new response is posted.
- **Email Sender Extraction:** For new tickets created via email, the daemon locates the automatically attached `.eml` file, extracts the sender's original email address (e.g., `Jane Doe <jane@example.com>`) using authenticated downloads, strips the signature from the card description, and prepends `**Ticket erstellt von:** [Sender]` to the description. For merged tickets, it prepends the sender to the update comment.
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
  `pm2 start "node <trello-dir>/controller.js listen 1" --name "trello-daemon"`
  Alternatively, macOS native **Launchd** or **Cron** (`crontab -e`) can be used to run the runner process at scheduled intervals.


## 9. Portable Paths
- `folder_path` in `projects.json` never contains a drive letter. Supported tokens: `%VAR%`, `${VAR}` and `~`; there are no built-in tokens. Example: `"folder_path": "%HTDOCS%/pec"`.
- Token values are defined at the top of `projects.json` in `PATH_VARS`: a hostname key (`os.hostname()`, e.g. `YOUR-HOSTNAME`) per machine, optional `"*"` for all machines. Drive letters live only there. Precedence: host block > `"*"` > process environment. Values may use tokens themselves (`"%WWW%/htdocs"`).
- The code never assumes a location outside its own folder: no sibling tools, no profile links, no parent-folder layout. A regression test checks the shipped files for it.
- If a token cannot be resolved, matching falls back to the last path segment against the current folder name (`pec`), so running from inside the project always works.
- Resolution lives in [`paths.js`](paths.js); regression tests: `node --test "<trello-dir>/tests/*.test.js"`.

## 10. Autopilot (Trello -> headless agent -> result line)
[`autopilot.js`](autopilot.js) processes exactly one card per run:
1. Resolves the project via `--board <project|board>` or the current folder, then the workspace root (see section 9).
2. Aborts if `active_ticket.json` exists in the root (running session or unresolved roadblock) or if tracked files are uncommitted.
3. Picks the top card in the Incoming list carrying the gate label (`autopilot.label` in `controller.json`, default `Autopilot`). Cards created by email are never processed without that label. `--card <shortLink> --approve` attaches the label as explicit approval by the caller (e.g. a chat bot command).
4. Runs `controller.js start`.
5. Pipes the ticket to the agent CLI (`autopilot.agentCommand` / `agentArgs`; default `claude -p` with Read/Edit/Write/Glob/Grep only, no Bash) via stdin.
6. Runs the `autopilot.checks` npm scripts (default `test`, `lint`) if defined in the project `package.json`, collects `git diff --shortstat` against the base hash. It never commits.
7. Success: `controller.js complete` (card -> Completed). Roadblock: card stays in Active, `active_ticket.json` stays as lock.
8. Posts a summary as Trello comment and ends with one stdout line `AUTOPILOT_RESULT {json}` (`formatResult` / `parseResult`). The autopilot never sends notifications itself; reporting is the caller's job.

- **Result and exit codes:** `status` `done` / `idle` / `skipped` exit `0`, `error` exit `1`, `roadblock` exit `2`. JSON fields: `status`, `project`, `card` (`shortLink`, `title`), `duration`, `reason`, `message`, `billing`, `git`, `checks`, `failedChecks` (`name`, `tail`), `summary`. `--dry-run` prints its preview JSON instead and no result line. stdout/stderr write errors are ignored, so a caller that disappears mid-run does not abort the run.
- **Billing (optional, autopilot only):** the agent runs without Bash and cannot bill itself, so the autopilot does it. `loadBilling()` in `paths.js` loads the module named by `BILLING_MODULE` in `projects.json` (tokens allowed), or returns `null` without it. Interface: `logPathFor(root)`, `openSession(log, title)`, `closeSession(log)` -> `{actual, estimate, mean}`, `dropSession(log)`, `appendItem(log, text)`. Billing is active only if the module loads and `logPathFor(root)` exists. Then: `openSession` before step 4; the prompt asks for a German billing item inside `<billing-item>…</billing-item>`, cut from the summary before the Trello comment; on success `closeSession` + `appendItem` (a neutral template if the agent delivered none, flagged in the `billing` field); on a roadblock `dropSession` (failed runs are not billed). Time and billing rules live in the module, not here.

```powershell
node <trello-dir>/autopilot.js --dry-run
node <trello-dir>/autopilot.js --board pec-website
node <trello-dir>/autopilot.js --board pec-website --card AbCd1234 --approve
```
