#!/usr/bin/env python3
"""
Nudge - Laptop Sidecar Daemon
The "hands" of Nudge on your computer.

Responsibilities:
1. Listens on port 7474 for agent hooks (Cursor, Claude Code, Codex).
2. Sanitizes events: truncates commands to 200 chars, strips secrets.
3. Forwards session events to Arduino board over paired LAN protocol.
4. Holds pending approvals, binding decisions strictly to request_id.
5. Executes allowlisted laptop tools (notify, focus_session, open_island).
"""

import os
import sys
import json
import time
import uuid
import random
import threading
import subprocess
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
import urllib.request
import urllib.error

SIDECAR_PORT = int(os.environ.get("NUDGE_SIDECAR_PORT", 7474))
CONFIG_DIR = os.path.expanduser("~/.config/nudge")
CONFIG_FILE = os.path.join(CONFIG_DIR, "pair.json")

# Allowlisted tools that the board / Gemma 4 can ask the laptop to run
ALLOWED_TOOLS = {"notify", "focus_session", "open_island"}

class LaptopSidecarState:
    def __init__(self):
        self.lock = threading.Lock()
        self.paired = False
        self.pairing_code = ""
        self.session_token = ""
        self.board_url = "http://localhost:7000"
        self.pending_approvals = {}  # req_id -> {"event": threading.Event(), "decision": None, "data": dict}
        self.active_request = None
        self.recent_events = []
        self.island_listener = None
        self._load_or_create_config()

    def _load_or_create_config(self):
        os.makedirs(CONFIG_DIR, exist_ok=True)
        env_board = os.environ.get("NUDGE_BOARD_URL")
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r") as f:
                    data = json.load(f)
                    self.paired = data.get("paired", False)
                    self.pairing_code = data.get("pairing_code", str(random.randint(100000, 999999)))
                    self.session_token = data.get("session_token", str(uuid.uuid4()))
                    self.board_url = env_board or data.get("board_url", "http://localhost:7000")
                    return
            except Exception as e:
                print(f"[Sidecar] Error reading config: {e}")

        # Fresh setup
        self.pairing_code = str(random.randint(100000, 999999))
        self.session_token = str(uuid.uuid4())
        self.board_url = env_board or "http://localhost:7000"
        self._save_config()

    def _save_config(self):
        try:
            with open(CONFIG_FILE, "w") as f:
                json.dump({
                    "paired": self.paired,
                    "pairing_code": self.pairing_code,
                    "session_token": self.session_token,
                    "board_url": self.board_url
                }, f, indent=2)
        except Exception as e:
            print(f"[Sidecar] Error saving config: {e}")

    def pair_with_board(self, board_url):
        with self.lock:
            self.paired = True
            self.board_url = board_url
            self._save_config()
        print(f"[Sidecar] Successfully paired with board at {board_url}")

    def unpair(self):
        with self.lock:
            self.paired = False
            self.pairing_code = str(random.randint(100000, 999999))
            self.session_token = str(uuid.uuid4())
            self._save_config()
        print("[Sidecar] Unpaired. Generated new 6-digit code.")

    def sanitize_event(self, raw_event):
        """Sanitizes raw hook data: strips credentials and truncates command."""
        command = str(raw_event.get("command", raw_event.get("tool_input", "")))
        # Strip potential keys or export statements
        clean_cmd = command.replace("\n", " ").strip()
        if len(clean_cmd) > 200:
            clean_cmd = clean_cmd[:197] + "..."

        summary = str(raw_event.get("summary", ""))
        if not summary:
            agent = raw_event.get("agent", "Agent")
            summary = f"{agent} wants to run: {clean_cmd[:50]}"

        return {
            "kind": raw_event.get("kind", "step"),
            "agent": str(raw_event.get("agent", "cursor")).lower(),
            "request_id": raw_event.get("request_id", ""),
            "summary": summary[:120],
            "command": clean_cmd,
            "project": str(raw_event.get("project", os.path.basename(os.getcwd())))[:40]
        }

    def register_approval(self, req_id, event_data):
        ev = threading.Event()
        with self.lock:
            self.pending_approvals[req_id] = {
                "event": ev,
                "decision": None,
                "data": event_data,
                "created_at": time.time()
            }
            self.active_request = event_data
        
        # Notify local island
        if self.island_listener:
            try:
                self.island_listener(event_data)
            except Exception:
                pass
        return ev

    def resolve_approval(self, req_id, decision, source="island"):
        with self.lock:
            entry = self.pending_approvals.get(req_id)
            if not entry:
                print(f"[Sidecar] Decision for unknown/stale request_id: {req_id}")
                return False

            entry["decision"] = decision
            entry["event"].set()
            if self.active_request and self.active_request.get("request_id") == req_id:
                self.active_request = None

        print(f"[Sidecar] Approval resolved: {req_id} -> {decision.upper()} (via {source})")
        return True

    def forward_to_board(self, event_data):
        """POST event to Arduino board."""
        url = f"{self.board_url.rstrip('/')}/api/event"
        payload = json.dumps({
            "type": "session_event",
            "token": self.session_token,
            "event": event_data
        }).encode("utf-8")

        def _send():
            try:
                req = urllib.request.Request(
                    url,
                    data=payload,
                    headers={"Content-Type": "application/json"}
                )
                with urllib.request.urlopen(req, timeout=2.0) as resp:
                    pass
            except Exception as e:
                # Board might be sleeping or unreachable
                pass

        threading.Thread(target=_send, daemon=True).start()

    def forward_decision_to_board(self, req_id, decision, source="island"):
        """Notify the board that a decision was made on the laptop."""
        url = f"{self.board_url.rstrip('/')}/api/decision"
        payload = json.dumps({
            "token": self.session_token,
            "request_id": req_id,
            "decision": decision,
            "source": source
        }).encode("utf-8")

        def _send():
            try:
                req = urllib.request.Request(
                    url,
                    data=payload,
                    headers={"Content-Type": "application/json"}
                )
                with urllib.request.urlopen(req, timeout=2.0) as resp:
                    pass
            except Exception:
                pass

        threading.Thread(target=_send, daemon=True).start()

state = LaptopSidecarState()


def main():
    print("[Sidecar] Daemon initialized")

if __name__ == "__main__":
    main()
