# Nudge protocol

Laptop sidecar and the UNO Q app speak JSON over HTTP. Gemma 3 1B on the board never sees API keys, file bodies, or raw repos — only short summaries.

Pairing is off until the sidecar is started. The laptop prints a 6-digit code. Enter it on Pip's Web UI. After a match, the board stores a session token; the laptop stores the board URL. "Pair again" replaces the token.

## Moods

`idle` | `peek` | `watching` | `needs_you` | `happy` | `annoyed` | `dizzy` | `asleep`

## Laptop → board `POST /api/event`

```json
{
  "type": "session_event",
  "token": "<pairing token>",
  "event": {
    "kind": "step | approval | question | done | chat",
    "agent": "cursor",
    "request_id": "uuid-or-empty",
    "summary": "Cursor wants to run git push",
    "command": "git push origin main",
    "project": "nudge"
  }
}
```

`command` is truncated by the sidecar (200 characters). The board drops events with a bad token.

## Board → laptop `POST /api/decision`

```json
{
  "token": "<pairing token>",
  "request_id": "exact-id-from-the-event",
  "decision": "allow | deny | always",
  "source": "button | island | chat"
}
```

The sidecar only applies a decision whose `request_id` is still waiting. Stale Allow is ignored.

## Gemma tools (board-local)

The model may return a JSON object (optionally fenced). Unknown keys and unknown tools are dropped.

```json
{
  "mood": "needs_you",
  "line": "Cursor wants git push",
  "tools": [
    {"name": "request_approval", "args": {"request_id": "…", "summary": "…", "command": "…"}},
    {"name": "notify", "args": {"title": "Nudge", "body": "Needs you"}},
    {"name": "focus_session", "args": {}},
    {"name": "open_island", "args": {}}
  ]
}
```

Allowed laptop tools in this build: `notify`, `focus_session`, `open_island`. There is no shell tool.

## Hook stdin (Claude Code / Cursor style)

`laptop/hooks/nudge-hook` reads one JSON object from stdin and POSTs it to the sidecar. Useful fields: `hook_event_name`, `tool_name`, `tool_input`, `cwd`, `permission_mode`, `session_id`.
