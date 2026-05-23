<p align="center">
  <img src="logo.png" alt="Trello Controller Daemon Logo" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="MIT License">
  <img src="https://img.shields.io/badge/Language-JavaScript-F7DF1E?logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/Platform-Node.js-339933?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Workflow-Agent%20Driven-7F187F" alt="Agent Driven">
  <img src="https://img.shields.io/badge/Dependencies-Lightweight-brightgreen" alt="Lightweight">
</p>

# Trello Controller Daemon

A lightweight, configuration-driven command-line interface (CLI) and background daemon runner for managing and automating multiple Trello boards, featuring built-in session tracking and billing logging.

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
- [Session Tracking & Billing Workflow](#session-tracking--billing-workflow)
  - [Step 1: Start a Session](#step-1-start-a-session)
  - [Step 2: Complete the Session](#step-2-complete-the-session)
  - [Working on Multiple Tickets in One Session](#working-on-multiple-tickets-in-one-session)
- [AI Agent & IDE Environment Integration](#ai-agent--ide-environment-integration)
- [Running as a Background Daemon](#running-as-a-background-daemon)

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
             "folder_path": "C:/path/to/your/project-a",
             "billing_path": "C:/path/to/billing-log-a.md"
           },
           {
             "name": "Project B",
             "folder_path": "C:/path/to/your/project-b",
             "billing_path": "C:/path/to/billing-log-b.md"
           }
         ],
         "LAST_CHECKED": ""
       }
     }
   }
   ```

2. Create a `controller.json` file based on your board labels, prefixes, and list priorities.

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

Navigate to any registered project directory in your terminal and call the script:

```bash
# List all cards grouped by list
node /path/to/trello-controller-daemon/controller.js list

# Synchronize labels and clean prefixes board-wide
node /path/to/trello-controller-daemon/controller.js sync

# Add a card to the "Release v1.0" list with automatic labeling
node /path/to/trello-controller-daemon/controller.js add "Release v1.0" "[BUG] Button is not working on mobile"

# Move a card to a different list
node /path/to/trello-controller-daemon/controller.js move "shortLink" "Active Tickets"

# Show new/unread incoming tickets across all registered boards
# Use "news peek" to view them without marking them as read (updating last_checked)
node /path/to/trello-controller-daemon/controller.js news
node /path/to/trello-controller-daemon/controller.js news peek
```

### Session Tracking & Billing Workflow

This tool includes an automated session calculator and billing logger that operates on a markdown logbook file (defined via `billing_path` inside the project's config block).

#### Step 1: Start a Session
Before starting your work, add an active session row to the session table in your markdown billing log:
```markdown
| Date | Start | End | Actual | Estimated | Description |
|---|---|---|---|---|---|
| 05/23/2026 | 14:15 | *Active* | | | In Progress (Ticket Name) |
```
Then, tell the controller to start the card (moves it to "Active Tickets" and posts a start comment):
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
2. Locate the active session row (`*Active*` or `In Progress`) in the logbook.
3. Calculate the actual elapsed time and update the session row with the end time, actual duration, and estimate.
4. Generate a consumer-ready billing item block and append it to the logbook.

#### Working on Multiple Tickets in One Session
If your session covers multiple tickets:
1. List all tickets in the active session row description:
   `| 05/23/2026 | 14:15 | *Active* | | | In Progress (Ticket A & Ticket B) |`
2. Start both cards on Trello using their respective shortLinks.
3. When completing:
   - Run `complete` on the **first ticket** first. This closes the active session in the logbook and generates the billing block.
   - Run `complete` on the **remaining tickets**. Since there is no longer an active session in the log, the controller will move them to "Completed Tickets" on Trello without creating duplicate log entries or messing up the logbook.

### AI Agent & IDE Environment Integration

This tool is designed to seamlessly integrate with modern **AI Coding Environments** and IDE Agents (such as Gemini, Antigravity, Cline, Cursor, Roo-Code, or GitHub Copilot). It bridges the gap between task management (Trello) and code execution, allowing the AI agent to operate the system **fully autonomously**.

#### How the Agent Handles the Controller:
1. **Task Ingestion:** When the agent starts, it runs `node .agents/trello/controller.js list` or reads the board configuration to find the next ticket.
2. **Autonomous Activation:** The agent executes the `start [shortLink]` command, which:
   - Moves the card to "Active Tickets" on Trello.
   - Automatically writes a clean, detailed task context file named `active_ticket.json` to the workspace root.
   - Adds an active time-tracking entry into the project's local billing log.
3. **Specification Parsing:** The agent reads `active_ticket.json` to get the full Trello card title, description, checklist items, and labels. The agent now has all the context it needs to write, debug, and test code for that ticket without human intervention.
4. **Interactive Checklists:** As the agent implements features, it checks off checklist items on Trello in real-time using `node .agents/trello/controller.js check-done [shortLink] "[itemName]"` to report progress.
5. **Auto-Completion & Time Tracking:** Once the task is complete, the agent runs the `complete [shortLink] "[estTime]"` command. This:
   - Moves the card to the completed list.
   - Calculates the exact time elapsed during the session.
   - Deletes `active_ticket.json`.
   - Generates and appends a consumer-ready billing line item to the project's markdown billing log.

This allows the agent to handle the entire lifecycle of a ticket fully automated, from start to completion and billing, with zero human overhead.

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
