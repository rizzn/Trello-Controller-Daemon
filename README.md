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

A **zero-dependency Node.js CLI and background daemon** that drives several Trello boards from
one central `projects.json`: card management, **session tracking** for AI coding agents, an
**email inbox processor** and an **autopilot** that hands one approved card to a headless agent.

## Table of contents

- [Quick start](#quick-start)
- [Structure](#structure)
- [Configuration](#configuration)
- [Commands](#commands)
- [Session tracking](#session-tracking)
- [Autopilot](#autopilot)
- [Background daemon](#background-daemon)
- [Email merging and reopening](#email-merging-and-reopening)
- [License](#license)

## Quick start

Requires **Node.js 18 or newer** (`autopilot.js` uses the global `fetch`). Only Node core modules
are used: no `npm install`, no `node_modules`.

1. Clone this repository into a central agents folder, e.g. `<agents-root>/tools/trello/`.
2. Point one profile link per machine at that agents folder. Projects need no link of their own.

   ```powershell
   # Windows, no admin rights needed
   New-Item -ItemType Junction -Path "$HOME\.agents-global" -Target "<agents-root>"
   ```

   ```bash
   # macOS / Linux
   ln -s "<agents-root>" "$HOME/.agents-global"
   ```

3. Copy `projects.example.json` to `projects.json` and fill in key, token and boards
   ([Configuration](#configuration)).
4. Run the controller from inside a registered project folder. The working directory selects the
   project:

   ```bash
   node $HOME/.agents-global/tools/trello/controller.js list
   ```

## Structure

| Path | Content |
|---|---|
| `controller.js` | CLI: cards, sessions, inbox processing, label sync, `listen` daemon loop |
| `autopilot.js` | One card per run: Trello → headless agent → checks → Trello and Telegram |
| `paths.js` | Path tokens (`PATH_VARS`), project lookup by working directory |
| `global_runner.js` | One `sync` + `inbox` pass over every registered board |
| `install_daemon.ps1`, `run_silent.vbs` | Windows scheduled task `TrelloInboxProcessor` |
| `start-trello.ps1`, `stop-trello.ps1` | Enable or disable that task |
| `controller.json` | Label priorities, prefix mappings, autopilot settings, comment templates |
| `projects.json` | Credentials and board ↔ project mapping (git-ignored) |
| `projects.example.json` | Template for `projects.json` |

## Configuration

### projects.json

Copy `projects.example.json`. One file holds the credentials and every board:

```jsonc
{
	"PATH_VARS":{                                   // token values per machine, see below
		"*":{"HTDOCS":"%AGENTS_ROOT%/../htdocs"},
		"YOUR-HOSTNAME":{"HTDOCS":"C:/xampp/htdocs"}
	},
	"TRELLO_KEY":"your_trello_api_key",
	"TRELLO_TOKEN":"your_trello_member_token",
	"TRELLO_BOARDS":{
		"https://trello.com/b/boardId1/project-a":{
			"TRELLO_BOARD_EMAIL":"your_board_email@boards.trello.com",  // email-to-board address
			"TRELLO_LIST_INCOMING":"Incoming Tickets",  // inbox list
			"TRELLO_LIST_ACTIVE":"Active Tickets",      // target of start
			"TRELLO_LIST_COMPLETED":"Completed Tickets",  // target of complete
			"LOCAL_PROJECTS":[
				{"name":"Project-A","folder_path":"%HTDOCS%/project-a"}  // "-" for a board without local folder
			],
			"LAST_CHECKED":null                         // maintained by news
		}
	}
}
```

- **Lists:** if `TRELLO_LIST_COMPLETED` is missing on the board, `complete` falls back to a list
  whose name contains `implemented`, `completed`, `complete` or `done`.
- **Board email:** board menu → **More** → **Email-to-board settings**. Point new mails at the
  inbox list.

### Portable paths

`folder_path` never contains a drive letter, so the same `projects.json` works on several
machines (e.g. synced via Dropbox).

- **Tokens:** `%VAR%`, `${VAR}`, `~` and the built-in `%AGENTS_ROOT%` (the central agents folder).
- **`PATH_VARS`:** one block per hostname (`os.hostname()`) plus an optional `"*"` block for all
  machines. Drive letters live only there. Precedence: host block > `"*"` > process environment >
  built-in `AGENTS_ROOT`. Values may use tokens themselves.
- **Fallback:** if a token cannot be resolved, the last path segment is matched against the name
  of the current folder, so running from inside the project always works.

### controller.json

```jsonc
{
	"priorityOrder":["Important","Bug","Feature","UI/UX","Refactor","Controlling"],  // order for sort
	"labelMappings":[
		{"prefix":"[BUG]","color":"red","name":"Bug"}  // title prefix → label, prefix is stripped
	],
	"autopilot":{
		"label":"Autopilot",                          // gate label, see Autopilot
		"labelColor":"sky",
		"agentCommand":"claude",
		"agentArgs":["-p","--permission-mode","acceptEdits","--allowedTools","Read,Edit,Write,Glob,Grep","--output-format","json"],
		"agentTimeoutMinutes":30,
		"checkTimeoutMinutes":10,
		"checks":["test","lint"]                      // npm scripts run after the agent, if defined
	},
	"messages":{
		"ticketReopened":"🔄 Ticket automatically reopened: A new email response was received.",
		"emailUpdateReceived":"✉️ Email update received for ticket:",
		"emailContentHeader":"Email Content",
		"noEmailContent":"No email content",
		"processingStarted":"Processing started at {timestamp}",
		"processingCompleted":"Processing completed at {timestamp}. Estimated effort: {estimated_duration}."
	}
}
```

`processingCompleted` supports `{timestamp}`, `{actual_duration}`, `{estimated_duration}` and
`{duration}` (same as the estimate).

## Commands

All commands run as `node $HOME/.agents-global/tools/trello/controller.js <command>` from inside
the project folder.

| Command | Arguments | Purpose |
|---|---|---|
| `list` | — | Show board lists and cards |
| `add` | `"Title" ["Desc"] ["ListName"]` | Create a card with automatic labels; without `ListName` it lands in the inbox list |
| `desc` | `shortLink "Description"` | Replace a card's description |
| `move` | `shortLink "ListName"` | Move a card to another list |
| `start` | `shortLink` | Move a card to the active list, post a start comment, write `active_ticket.json` |
| `complete` | `shortLink ["estTime"]` | Move a card to the completed list, post actual and estimated time |
| `check` | `shortLink "Item"` | Add a checklist item |
| `check-done` | `shortLink "Item"` | Mark a checklist item done and update `active_ticket.json` |
| `label` | `shortLink Color ["LabelName"]` | Add a label |
| `comment` | `shortLink "Text"` | Add a comment |
| `archive` | `shortLink` | Archive a card |
| `delete` | `shortLink` | Delete a card permanently |
| `search` | `"Query"` | Search cards on the board |
| `inbox` | — | Run inbox processing and email merging once |
| `sync` | — | Sync labels from `controller.json`, strip title prefixes board-wide |
| `sort` | — | Sort cards by `priorityOrder` |
| `listen` | `[intervalMinutes]` | Poll the inbox in the foreground; default `0.1667` (10 s) |
| `news` / `unread` | `[peek]` | New tickets across all boards; `peek` leaves `LAST_CHECKED` untouched |
| `status` | — | State of the daemon process and the scheduled task |
| `projects` | — | Registered projects, the `~/.agents-global` link, legacy project `.agents` links |
| `backup` | — | Export the board to `board_backup.txt` |

```bash
node $HOME/.agents-global/tools/trello/controller.js add "[BUG] Button dead on mobile" "Steps: …"
node $HOME/.agents-global/tools/trello/controller.js move AbCd1234 "Active Tickets"
node $HOME/.agents-global/tools/trello/controller.js news peek
```

## Session tracking

An agent (or a human) works a ticket in two steps:

1. **`start shortLink`** moves the card to the active list, posts `processingStarted` and writes
   `active_ticket.json` into the project root: title, description, checklists, labels and
   `startedAtIso`. The agent reads its task from that file.
2. **`complete shortLink ["estTime"]`** moves the card to the completed list, posts
   `processingCompleted` with the elapsed time from `active_ticket.json` and deletes the file.
   Without `estTime` the estimate equals the actual time.

- **Several tickets in one session:** `start` and `complete` each of them. The duration comment
  goes to the card stored in `active_ticket.json`; the others are only moved.
- **Completed cards are never archived** by `complete`.
- **Git:** add `active_ticket.json` to the project's `.gitignore`.

## Autopilot

`autopilot.js` processes exactly one card per run and never commits:

```bash
node $HOME/.agents-global/tools/trello/autopilot.js --dry-run              # show the card it would take
node $HOME/.agents-global/tools/trello/autopilot.js --board project-a      # project or board context
node $HOME/.agents-global/tools/trello/autopilot.js --board project-a --card AbCd1234 --approve
```

1. Resolves the project from `--board` or the current folder.
2. Stops if `active_ticket.json` exists (running session or open roadblock) or tracked files are
   uncommitted.
3. Takes the top inbox card carrying the gate label (`autopilot.label`). Cards created by email are
   never processed without it. `--card … --approve` attaches the label as explicit approval.
4. Runs `start`, pipes the ticket to the agent CLI (`agentCommand` / `agentArgs`; default
   `claude -p` without Bash) and then the `checks` npm scripts.
5. Success: `complete`. Roadblock: the card stays active and `active_ticket.json` stays as lock.
6. Posts a summary as card comment and sends a report via the sibling tool
   `../telegram/controller.js` (`NOTIFY_CHAT_ID` in its `config.json`); skipped without it.

- **Billing (optional):** with the `billing-manager` skill in the agents folder
  (`skills/billing-manager/scripts/billing.js`) and an existing log for the workspace, the
  autopilot books the run and a billing item; failed runs are not billed. Without the skill the
  report shows billing as inactive.

## Background daemon

```bash
node $HOME/.agents-global/tools/trello/global_runner.js            # one sync + inbox pass, all boards
node $HOME/.agents-global/tools/trello/controller.js listen 0.1667  # foreground loop, 10 s interval
```

- **Windows:** `powershell -ExecutionPolicy Bypass -File install_daemon.ps1` registers the task
  `TrelloInboxProcessor`. It starts `run_silent.vbs` every minute, which polls in a 10-second loop.
  `start-trello.ps1` and `stop-trello.ps1` enable and disable it. No admin rights needed.
- **macOS / Linux:** run the loop under PM2, launchd or cron:

  ```bash
  pm2 start "node $HOME/.agents-global/tools/trello/controller.js listen 0.1667" --name trello-daemon
  ```

## Email merging and reopening

The inbox pass keeps email threads on one card:

- **Merging:** a new card like `Re: [BUG] Video player crash` is matched to the original by its
  normalized title (email prefixes `Re:`, `Aw:`, `Fwd:`, `WG:` and label prefixes stripped). The
  cleaned body becomes a comment, attachments are moved over, the duplicate is deleted.
- **Trello-native replies:** comments that Trello posts from email replies are processed the same
  way.
- **Cleanup:** salutations, device signatures and quoted history are cut from descriptions and
  comments.
- **Sender:** the sender address from the attached `.eml` is prepended as
  `**Ticket erstellt von:** <sender>` to the description or the merged comment.
- **Reopening:** a reply to an archived or completed card restores it to the inbox and posts
  `ticketReopened` — only if the reply is newer than the card's last move to completed or its
  archiving, so manual closing is never undone.

## License

MIT — see [`LICENSE`](LICENSE).
