<p align="center">
  <img src="logo.png" alt="Trello Controller Daemon Logo" width="100%">
</p>
<!-- logo-ref -->

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="MIT License">
  <img src="https://img.shields.io/badge/Language-JavaScript-F7DF1E?logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/Platform-Node.js-339933?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Workflow-Agent%20Driven-7F187F" alt="Agent Driven">
  <img src="https://img.shields.io/badge/Dependencies-Lightweight-brightgreen" alt="Lightweight">
</p>

# Trello Controller Daemon

A lightweight, configuration-driven command-line interface (CLI) and background daemon runner for managing and automating multiple Trello boards, featuring built-in session tracking. Billing logs are not part of this tool — they live in the [`billing-manager`](../../skills/billing-manager/SKILL.md) skill.

Built completely in native Node.js without heavy external dependencies.

## Table of Contents

- [Features](#features)
- [Installation & Folder Structure](#installation--folder-structure)
  - [1. Global Folder Setup](#1-global-folder-setup)
  - [2. Local Project Symlink](#2-local-project-symlink)
- [Requirements & Dependencies](#requirements--dependencies)
- [Configuration](#configuration)
  - [Board List Requirements](#board-list-requirements)
- [Usage & Commands](#usage--commands)
- [Session Tracking Workflow](#session-tracking-workflow)
  - [Step 1: Start a Session](#step-1-start-a-session)
  - [Step 2: Complete the Session](#step-2-complete-the-session)
  - [Working on Multiple Tickets in One Session](#working-on-multiple-tickets-in-one-session)
- [AI Agent & IDE Environment Integration](#ai-agent--ide-environment-integration)
- [Running as a Background Daemon](#running-as-a-background-daemon)

## Features

- **CLI Card Management:** List, search, add, move, comment, label, archive, and delete Trello cards instantly from the terminal.
- **Board Synchronization (`sync`):** Dynamically updates and syncs label configurations (colors, names) defined in `controller.json` with the Trello board.
- **Automated Label Parsing:** Parses custom ticket prefixes (like `[BUG]`, `[FEATURE]`) in card titles, cleans card titles on Trello, and automatically applies corresponding color-coded labels.
- **Session Tracking (`start` / `complete` / `check-done`):**
  - Track session durations via `active_ticket.json` and post actual and estimated time as a card comment.
  - Billing rows and client billing items are written by the [`billing-manager`](../../skills/billing-manager/SKILL.md) skill, not by this tool.
- **Project-Agnostic Registry (`projects.json`):** Manage multiple local projects and their Trello credentials from a single, centralized configuration.
- **Background Daemon Polling (`listen` / Runner):** Set up a background cron/task to periodically poll inbox lists and parse cards silently.
- **Automatic Ticket Merging (E-Mail Threading):** Automatically merges email replies/updates (e.g. `Re:`, `Aw:`) sent to the board's email address into existing cards as comments by matching normalized titles, copying description texts, and transferring files/attachments.
- **Email Sender Extraction & Cleanup:** Extracts the original sender's email address (via `.eml` parsing) and prepends it directly to the card description (`**Ticket erstellt von:** [Sender]`) or comment header, while fully stripping out signatures, greeting lines, and previous reply history to keep the board clean.
- **Board Backups:** Exports board structures and cards into a clean local text document (`board_backup.txt`).

## Installation & Folder Structure

To use the Trello Controller across multiple projects efficiently, place this folder globally under a central directory and reach it through one link in the user profile — projects need no link of their own:

### 1. Global Folder Setup
Place the cloned files inside a central directory of your choice, for example:
`C:\global\.agents\tools\trello\`

### 2. Profile Link (once per machine)
Create a directory junction `~/.agents-global` that points to the global agents directory. On Windows (PowerShell, no admin rights needed):
```powershell
New-Item -ItemType Junction -Path "$HOME\.agents-global" -Target "C:\global\.agents"
```

Run the controller from inside the project folder (the working directory selects the project):
`node $HOME/.agents-global/tools/trello/controller.js [command]`

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
     "TRELLO_KEY": "your_trello_api_key",
     "TRELLO_TOKEN": "your_trello_member_token",
     "TRELLO_BOARDS": {
       "https://trello.com/b/board_id/board_name": {
         "TRELLO_BOARD_EMAIL": "your_board_email@boards.trello.com",
         "TRELLO_LIST_INCOMING": "Incoming Tickets",
         "TRELLO_LIST_ACTIVE": "Active Tickets",
         "TRELLO_LIST_COMPLETED": "Completed Tickets",
         "LOCAL_PROJECTS": [
           {
             "name": "Project A",
             "folder_path": "C:/path/to/your/project-a"
           },
           {
             "name": "Project B",
             "folder_path": "C:/path/to/your/project-b"
           }
         ],
         "LAST_CHECKED": ""
       }
     }
   }
   ```

> [!NOTE]
> **Cross-Platform & Laptop Portability:**
> To ensure seamless synchronization between different machines (e.g., Desktop and Laptop via Dropbox) where absolute paths might differ:
> - **Folder Path Fallback:** If the current working directory path does not exactly match `folder_path` in `projects.json` (due to different drive letters or parent folders), the controller automatically falls back to matching the base directory name (e.g. `project-a`).

2. Create a `controller.json` file containing your board label priorities, prefix mappings, and custom automated message templates:
   ```json
   {
     "priorityOrder": [
       "Important",
       "Bug",
       "Feature",
       "UI/UX",
       "Refactor",
       "Controlling"
     ],
     "labelMappings": [
       {
         "prefix": "[BUG]",
         "color": "red",
         "name": "Bug"
       }
     ],
     "messages": {
       "ticketReopened": "🔄 Ticket automatically reopened: A new email response was received.",
       "emailUpdateReceived": "✉️ Email update received for ticket:",
       "emailContentHeader": "Email Content",
       "noEmailContent": "No email content",
       "processingStarted": "Processing started at {timestamp}",
       "processingCompleted": "Processing completed at {timestamp}. Estimated effort: {estimated_duration}."
     }
   }
   ```

#### How to find your Trello Board Email (`TRELLO_BOARD_EMAIL`):
1. Open your Trello Board in your web browser.
2. Open the Board Menu on the right (click **Show Menu** or `...` under your board header).
3. Click **More**.
4. Select **Email-to-board settings**.
5. Copy your unique board email address shown there. You can also configure which list and card position new emails should go to (recommended: target your Incoming Tickets list).

### Board List Requirements
To ensure the automated workflows function correctly, your Trello board must contain:
- **Inbox List:** Configured via `TRELLO_LIST_INCOMING` in `projects.json` (defaults to `"Incoming Tickets"` if not set).
- **Active Work List:** Configured via `TRELLO_LIST_ACTIVE` in `projects.json` (defaults to `"Active Tickets"` if not set).
- **Completed List:** Configured via `TRELLO_LIST_COMPLETED` in `projects.json` (defaults to `"Completed Tickets"`). If the specified list is not found, the controller falls back to checking list names containing `"implemented"`, `"completed"`, `"complete"`, or `"done"`.

## Usage

Navigate to any registered project directory in your terminal and execute `controller.js`.

### CLI Command Quick Reference

| Command | Usage | Description |
| :--- | :--- | :--- |
| `list` | `node $HOME/.agents-global/tools/trello/controller.js list` | Show board lists and cards. |
| `add` | `node $HOME/.agents-global/tools/trello/controller.js add "Title" ["Desc"] ["ListName"]` | Create a new card with automatic label assignment. |
| `desc` | `node $HOME/.agents-global/tools/trello/controller.js desc [shortLink] "Description"` | Update a card's description. |
| `move` | `node $HOME/.agents-global/tools/trello/controller.js move [shortLink] "ListName"` | Move a card to another list. |
| `start` | `node $HOME/.agents-global/tools/trello/controller.js start [shortLink]` | Move a card to "Active Tickets", track start time, create local `active_ticket.json`. |
| `complete` | `node $HOME/.agents-global/tools/trello/controller.js complete [shortLink] "[estTime]"` | Move card to "Completed Tickets", post actual/estimated time as a comment. |
| `check` | `node $HOME/.agents-global/tools/trello/controller.js check [shortLink] "ItemName"` | Add a checklist item to a card. |
| `check-done` | `node $HOME/.agents-global/tools/trello/controller.js check-done [shortLink] "ItemName"` | Mark a checklist item as completed and update local JSON. |
| `label` | `node $HOME/.agents-global/tools/trello/controller.js label [shortLink] [Color] ["LabelName"]` | Add a label to a card. |
| `comment` | `node $HOME/.agents-global/tools/trello/controller.js comment [shortLink] "Text"` | Add a comment to a card. |
| `archive` | `node $HOME/.agents-global/tools/trello/controller.js archive [shortLink]` | Archive a card. |
| `delete` | `node $HOME/.agents-global/tools/trello/controller.js delete [shortLink]` | Permanently delete a card. |
| `search` | `node $HOME/.agents-global/tools/trello/controller.js search "Query"` | Search for cards on the board. |
| `inbox` | `node $HOME/.agents-global/tools/trello/controller.js inbox` | Run manual incoming ticket & email merging logic. |
| `sync` | `node $HOME/.agents-global/tools/trello/controller.js sync` | Synchronize board labels & clean card title prefixes board-wide. |
| `listen` | `node $HOME/.agents-global/tools/trello/controller.js listen [intervalMinutes]` | Start the persistent inbox polling daemon in the foreground. |
| `news` / `unread` | `node $HOME/.agents-global/tools/trello/controller.js news [peek]` | Show new/unread tickets across all boards. Use `peek` to list without updating LAST_CHECKED. |
| `status` | `node $HOME/.agents-global/tools/trello/controller.js status` | Display the status of the background daemon process and scheduled task. |
| `projects` | `node $HOME/.agents-global/tools/trello/controller.js projects` | List registered projects and paths, the `~/.agents-global` profile link, and legacy project `.agents` links. |
| `backup` | `node $HOME/.agents-global/tools/trello/controller.js backup` | Export the current board layout to `board_backup.txt`. |
| `sort` | `node $HOME/.agents-global/tools/trello/controller.js sort` | Sort cards in lists based on priorities. |

### CLI Examples:

```bash
# List all cards grouped by list
node $HOME/.agents-global/tools/trello/controller.js list

# Synchronize labels and clean prefixes board-wide
node $HOME/.agents-global/tools/trello/controller.js sync

# Add a card to the "Release v1.0" list with automatic labeling
node $HOME/.agents-global/tools/trello/controller.js add "Release v1.0" "[BUG] Button is not working on mobile"

# Move a card to a different list
node $HOME/.agents-global/tools/trello/controller.js move "shortLink" "Active Tickets"

# Show new/unread incoming tickets across all registered boards
node $HOME/.agents-global/tools/trello/controller.js news
```


### Session Tracking Workflow

The controller tracks the session on the card; the billing log (session row, client billing item) is handled separately by the [`billing-manager`](../../skills/billing-manager/SKILL.md) skill, the same way with or without Trello.

#### Step 1: Start a Session
Start the card (moves it to "Active Tickets", posts a start comment and writes `active_ticket.json` with the start time):
```bash
node /path/to/trello-controller-daemon/controller.js start "shortLink"
```

#### Step 2: Complete the Session
When done, complete the session by specifying the card's shortLink and a manual human time-estimate (e.g. `"1h 30m"` or `"45m"`):
```bash
node /path/to/trello-controller-daemon/controller.js complete "shortLink" "1h 30m"
```
The controller will automatically:
1. Move the card to the **"Completed Tickets"** list (or the list configured in `TRELLO_LIST_COMPLETED`).
2. Calculate the elapsed time from `active_ticket.json` and post actual and estimated duration as a card comment.
3. Delete `active_ticket.json`.

#### Working on Multiple Tickets in One Session
Start every card with `start` and complete every card with `complete`. The duration comment goes to the card stored in `active_ticket.json`; the other cards are only moved.

### AI Agent & IDE Environment Integration

This tool is designed to seamlessly integrate with modern **AI Coding Environments** and IDE Agents (such as Gemini, Antigravity, Cline, Cursor, Roo-Code, or GitHub Copilot). It bridges the gap between task management (Trello) and code execution, allowing the AI agent to operate the system **fully autonomously**.

#### How the Agent Handles the Controller:
1. **Task Ingestion:** When the agent starts, it runs `node $HOME/.agents-global/tools/trello/controller.js list` or reads the board configuration to find the next ticket.
2. **Autonomous Activation:** The agent executes the `start [shortLink]` command, which:
   - Moves the card to "Active Tickets" on Trello.
   - Automatically writes a clean, detailed task context file named `active_ticket.json` to the workspace root.
3. **Specification Parsing:** The agent reads `active_ticket.json` to get the full Trello card title, description, checklist items, and labels. The agent now has all the context it needs to write, debug, and test code for that ticket without human intervention.
4. **Interactive Checklists:** As the agent implements features, it checks off checklist items on Trello in real-time using `node $HOME/.agents-global/tools/trello/controller.js check-done [shortLink] "[itemName]"` to report progress.
5. **Auto-Completion & Time Tracking:** Once the task is complete, the agent runs the `complete [shortLink] "[estTime]"` command. This:
   - Moves the card to the completed list.
   - Calculates the exact time elapsed during the session and posts it as a comment.
   - Deletes `active_ticket.json`.
6. **Billing:** If billing is active for the workspace, the agent closes the session row and appends the billing item with the [`billing-manager`](../../skills/billing-manager/SKILL.md) skill.

This allows the agent to handle the entire lifecycle of a ticket, from start to completion, with zero human overhead.

#### Recommended `.gitignore`:
To prevent tracking temporary workspace ticket context in your git commits, add `active_ticket.json` to your project's local `.gitignore` file:
```text
# AI Agent temporary session ticket context
active_ticket.json
```

### Running as a Background Daemon

Start the runner to periodically poll and process incoming cards in the background:

```bash
# Execute a single synchronization and inbox pass
node /path/to/trello-controller-daemon/global_runner.js

# Start persistent listen mode (runs in foreground, polling every X minutes)
# Supports decimal values like 0.1667 (for a 10-second interval)
node /path/to/trello-controller-daemon/controller.js listen 0.1667
```

#### Windows Configuration
To run it completely hidden in the background on Windows (polling every 10 seconds), you can simply run the automated PowerShell installer script in the daemon directory (no admin rights needed):
```powershell
powershell -ExecutionPolicy Bypass -File install_daemon.ps1
```
This automatically registers the task `TrelloInboxProcessor` in your Windows Task Scheduler to run the `run_silent.vbs` script every 1 minute, which executes a 10-second polling loop inside.

You can also control the daemon using the new helper scripts:
- **Start / Enable Daemon:** `.\start-trello.ps1`
- **Stop / Disable Daemon:** `.\stop-trello.ps1`

#### macOS / Linux Configuration
On macOS or Linux, you can manage the daemon using **PM2** (Process Manager 2) to ensure it stays active, restarts on system boot, and recovers from errors:
```bash
pm2 start "node /path/to/trello-controller-daemon/controller.js listen 0.1667" --name "trello-daemon"
```
Alternatively, schedule it using macOS native `launchd` plist agents or `crontab -e`.

## Automatic Ticket Merging & Reopening (Email & Comment Replies)

To keep your board clean, professional, and organized, the background daemon automatically processes incoming email replies and Trello-native comments:

1. **Email-to-Card Merging:** When a user replies to an existing ticket email and a new card is created (e.g., `Re: [BUG] Video player crash`), the daemon strips email/label prefixes, merges the message as a comment on the original card, transfers any attachments, and deletes the duplicate card.
2. **Trello-Native Comments:** If a user replies to a notification email and Trello posts the message directly as a comment on the existing card, the daemon automatically detects and processes it.
3. **Email Reply & Comment Cleanup:** To prevent comment clutter, the daemon automatically cleanses email descriptions and comments. It removes closing salutations (e.g., `Mit freundlichen Grüßen`, `Viele Grüße`, `Kind regards`), device signatures (e.g., `Gesendet von meinem iPhone`, `Gesendet aus Outlook`), and previous conversation history quoted underneath.
4. **Auto-Reopening:** If the original ticket is archived or currently residing in the **"Completed Tickets"** list, the daemon automatically restores it (unarchives it) and moves it back to the **Inbox** (`Incoming Tickets`), posting a reopening notification comment.
5. **Date Protection Check:** To prevent cards from being falsely reopened when you manually move them back to Completed Tickets or archive them, the daemon compares the comment's creation timestamp against the card's latest move-to-completed or archiving timestamp. The card is only reopened if the comment was posted *after* the move occurred.

## License

MIT License. Feel free to use and customize.
