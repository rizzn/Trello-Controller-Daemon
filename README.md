# Trello Controller Daemon

A lightweight, configuration-driven command-line interface (CLI) and background daemon runner for managing and automating multiple Trello boards, featuring built-in session tracking and billing logging.

Built completely in native Node.js without heavy external dependencies.

## Features

- **CLI Card Management:** List, search, add, move, comment, label, archive, and delete Trello cards instantly from the terminal.
- **Board Synchronization (`sync`):** Dynamically updates and syncs label configurations (colors, names) defined in `controller.json` with the Trello board.
- **Automated Label Parsing:** Parses custom ticket prefixes (like `[BUG]`, `[FEATURE]`) in card titles, cleans card titles on Trello, and automatically applies corresponding color-coded labels.
- **Session Tracking & Billing Logs (`complete` / `check-done`):**
  - Track session durations.
  - Automatically log completed tickets and checklists into a localized Markdown billing file (`billing-log.md`) with a user-friendly title, consumer details, and time-saving metrics.
- **Project-Agnostic Registry (`projects.json`):** Manage multiple local projects and their Trello credentials from a single, centralized configuration.
- **Background Daemon Polling (`listen` / Runner):** Set up a background cron/task to periodically poll inbox lists and parse cards silently.
- **Board Backups:** Exports board structures and cards into a clean local text document (`board_backup.txt`).

## Installation & Folder Structure

To use the Trello Controller across multiple projects efficiently, it is recommended to place this folder globally under a central directory (e.g., `C:\global\.agents\trello`) and link it to each project workspace:

### 1. Global Folder Setup
Place the cloned files inside a central directory of your choice, for example:
`C:\global\.agents\trello\`

### 2. Local Project Symlink
In each of your project directories, create a symbolic link named `.agents` that points to the global agents directory. On Windows (PowerShell):
```powershell
New-Item -ItemType SymbolicLink -Path ".\.agents" -Target "C:\global\.agents"
```

Once linked, any local shell or AI Assistant can access and execute the controller using a uniform, relative path:
`node .agents/trello/controller.js [command]`

This ensures zero configuration overhead per workspace.

## Requirements & Dependencies

- **Node.js:** Node.js (v12.x or higher recommended) must be installed.
- **Zero External Dependencies:** This tool uses 100% native Node.js core APIs (`https`, `fs`, `path`, `child_process`).
  - **No `npm install` required.**
  - **No `node_modules` directory required.**
  - Zero vulnerability risks or network installation overhead.

## Configuration

1. Create a `projects.json` file based on `projects.example.json`:
   ```json
   {
     "C:/path/to/your/project-a": {
       "TRELLO_KEY": "your_trello_api_key",
       "TRELLO_TOKEN": "your_trello_member_token",
       "TRELLO_BOARD_URL": "https://trello.com/b/board_id/board_name",
       "TRELLO_BOARD_EMAIL": "your_board_email@boards.trello.com",
       "TRELLO_INBOX_LIST": "Incoming Tickets",
       "TRELLO_ACTIVE_LIST": "Active Tickets",
       "TRELLO_COMPLETED_LIST": "Completed Tickets",
       "BILLING_LOG_FILE": "C:/path/to/billing-log.md"
     }
   }
   ```

#### How to find your Trello Board Email (`TRELLO_BOARD_EMAIL`)
1. Open your Trello Board in your web browser.
2. Open the Board Menu on the right (click **Show Menu** or `...` under your board header).
3. Click **More** (or **Mehr** in German).
4. Select **Email-to-board settings** (or **Einstellungen für E-Mail an Board**).
5. Copy your unique board email address shown there. You can also configure which list and card position new emails should go to (recommended: target your Incoming Tickets list).
2. Create a `controller.json` file based on your board labels, prefixes, and list priorities.

### Board List Requirements
To ensure the automated workflows function correctly, your Trello board must contain:
- **Inbox List:** Configured via `TRELLO_INBOX_LIST` in `projects.json` (defaults to `"Incoming Tickets"` if not set).
- **Active Work List:** Configured via `TRELLO_ACTIVE_LIST` in `projects.json` (defaults to `"Active Tickets"` if not set).
- **Completed List:** Configured via `TRELLO_COMPLETED_LIST` in `projects.json` (defaults to `"Completed Tickets"`). If the specified list is not found, the controller falls back to checking list names containing `"implemented"`, `"completed"`, `"complete"`, or `"done"`.

## Usage

Navigate to any registered project directory in your terminal and call the script:

```bash
# List all cards grouped by list
node /path/to/trello-controller-daemon/controller.js list

# Synchronize labels and clean prefixes board-wide
node /path/to/trello-controller-daemon/controller.js sync

# Add a card to the "Release v1.0" list with automatic labeling
node /path/to/trello-controller-daemon/controller.js add "Release v1.0" "[BUG] Button is not working on mobile"

# Move a card to a different list
node /path/to/trello-controller-daemon/controller.js move "shortLink" "Working on"
```

### Session Tracking & Billing Workflow

This tool includes an automated session calculator and billing logger that operates on a markdown logbook file (defined in `BILLING_LOG_FILE`).

#### Step 1: Start a Session
Before starting your work, add an active session row to the session table in your markdown billing log:
```markdown
| Datum | Start | Ende | Tatsächlich | Geschätzt | Beschreibung |
|---|---|---|---|---|---|
| 23.05.2026 | 14:15 | *Aktiv* | | | In Arbeit (Ticket-Name) |
```
Then, tell the controller to start the card (moves it to "Working on" and posts a start comment):
```bash
node /path/to/trello-controller-daemon/controller.js start "shortLink"
```

#### Step 2: Complete the Session
When done, complete the session by specifying the card's shortLink and a manual human time-estimate (e.g. `"1h 30m"` or `"45m"`):
```bash
node /path/to/trello-controller-daemon/controller.js complete "shortLink" "1h 30m"
```
The controller will automatically:
1. Move the card to the **"Implemented"** or **"Done"** list on your board (completed tickets are moved here to keep them visible rather than archiving them).
2. Locate the `*Aktiv*` or `In Arbeit` row in your markdown logbook.
3. Calculate the actual elapsed time.
4. Replace `*Aktiv*` with the current time and update the duration fields.
5. Append a consumer-ready billing item block at the bottom of your logbook including details, customer benefits, and efficiency comparisons.

#### Working on Multiple Tickets in One Session
If your session covers multiple tickets:
1. List all tickets in the active session row description:
   `| 23.05.2026 | 14:15 | *Aktiv* | | | In Arbeit (Ticket A & Ticket B) |`
2. Start both cards on Trello using their respective shortLinks.
3. When completing:
   - Run `complete` on the **first ticket** first. This closes the active session in the logbook and generates the billing block.
   - Run `complete` on the **remaining tickets**. Since there is no longer an active session in the log, the controller will move them to "Implemented" on Trello without creating duplicate log entries or messing up the logbook.

### AI Agent Integration & `active_ticket.json`

This tool serves as a **context provider** for AI Assistants and IDE Agents (like Cursor, Gemini, Cline, or Copilot). 

When you run the `start` command:
1. The controller fetches the Trello card's full details (Title, Description, Labels, and Checklist Items).
2. It writes a temporary file named `active_ticket.json` directly into your workspace root.
3. Any AI Agent scanning the workspace instantly reads this file to understand its exact task, specification, and acceptance criteria without manual copy-pasting.

#### Keeping check items in sync:
* Adding checklist items (`check`) or marking them completed (`check-done`) automatically fetches the updated state from Trello and synchronizes it with the local `active_ticket.json`.
* Completing the session (`complete`) automatically deletes the temporary `active_ticket.json` file from the workspace.

#### Recommended `.gitignore`:
To prevent tracking temporary workspace ticket context in your git commits, add `active_ticket.json` to your project's local `.gitignore` file:
```text
# AI Agent temporary session ticket context
active_ticket.json
```

### Running as a Background Daemon

Start the runner to periodically poll and process incoming cards in the background:

```bash
node /path/to/trello-controller-daemon/global_runner.js
```

To run it completely hidden in the background on Windows, trigger `run_silent.vbs` via the Windows Task Scheduler.

## License

MIT License. Feel free to use and customize.
