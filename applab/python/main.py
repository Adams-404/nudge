#!/usr/bin/env python3
"""
Nudge - Board Agent for Arduino UNO Q
Runs on the board's Linux MPU alongside local Gemma 4 (arduino:llm brick).

Responsibilities:
1. Web UI server on port 7000 (Pip character, chat, demo mode, approvals).
2. Laptop protocol on port 8766 (and 7000): session events, pairing, decisions.
3. Gemma 4 triage engine: analyzes agent hooks, outputs mood + strict tool JSON.
4. Bridge RPC with MCU: controls LED matrix face, receives physical buttons & pokes.
"""

import os
import sys
import json
import time
import uuid
import re
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading
from urllib.parse import urlparse, parse_qs

# Optional RouterBridge on Arduino UNO Q Linux MPU
try:
    import arduino_router_bridge as bridge
    HAS_BRIDGE = True
except ImportError:
    HAS_BRIDGE = False

PORT_WEB = int(os.environ.get("NUDGE_WEB_PORT", 7000))
PORT_API = int(os.environ.get("NUDGE_API_PORT", 8766))
ASSETS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "assets"))
DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
PAIRING_FILE = os.path.join(DATA_DIR, "pairing.json")

# LLM endpoint (default to App Lab's local llama.cpp / Gemma 4 endpoint)
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://127.0.0.1:8080/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "llamacpp:gemma-4-e2b")

# Allowed moods
ALLOWED_MOODS = {"idle", "peek", "watching", "needs_you", "happy", "annoyed", "dizzy", "asleep"}

# Allowed laptop tools (strict allowlist)
ALLOWED_TOOLS = {"request_approval", "notify", "focus_session", "open_island"}

class NudgeState:
    def __init__(self):
        self.lock = threading.Lock()
        self.mood = "idle"
        self.mood_reason = "Pip is waiting for coding sessions"
        self.one_liner = "Pip is ready"
        self.paired = False
        self.pairing_token = None
        self.laptop_url = None
        self.active_request = None  # {request_id, summary, command, agent, project, timestamp}
        self.recent_events = []
        self.chat_history = []
        self.poke_count = 0
        self.last_poke_time = 0.0
        self.listeners = []  # SSE response queues
        self.demo_running = False
        self._load_pairing()

    def _load_pairing(self):
        try:
            if os.path.exists(PAIRING_FILE):
                with open(PAIRING_FILE, "r") as f:
                    data = json.load(f)
                    self.paired = data.get("paired", False)
                    self.pairing_token = data.get("token")
                    self.laptop_url = data.get("laptop_url")
        except Exception as e:
            print(f"[State] Error loading pairing: {e}")

    def save_pairing(self, token, laptop_url=None):
        with self.lock:
            self.paired = True
            self.pairing_token = token
            if laptop_url:
                self.laptop_url = laptop_url
            os.makedirs(DATA_DIR, exist_ok=True)
            with open(PAIRING_FILE, "w") as f:
                json.dump({"paired": True, "token": token, "laptop_url": self.laptop_url}, f)
        self.notify_change("paired")

    def unpair(self):
        with self.lock:
            self.paired = False
            self.pairing_token = None
            self.laptop_url = None
            if os.path.exists(PAIRING_FILE):
                try:
                    os.remove(PAIRING_FILE)
                except OSError:
                    pass
        self.notify_change("unpaired")

    def set_mood(self, mood, reason=""):
        if mood not in ALLOWED_MOODS:
            mood = "idle"
        with self.lock:
            self.mood = mood
            if reason:
                self.mood_reason = reason
        # Send to MCU bridge if present
        mcu_bridge.set_mood(mood)
        self.notify_change("mood")

    def poke(self):
        now = time.time()
        with self.lock:
            if now - self.last_poke_time < 2.0:
                self.poke_count += 1
            else:
                self.poke_count = 1
            self.last_poke_time = now

            if self.poke_count >= 3:
                new_mood = "dizzy"
                reason = "Whoa! Too many pokes! *spins*"
            else:
                new_mood = "annoyed"
                reason = "Hey! Don't poke Pip while working!"

        self.set_mood(new_mood, reason)

        # Reset back to idle or watching after 3.5 seconds
        def restore_mood():
            time.sleep(3.5)
            with self.lock:
                target = "watching" if self.active_request else "idle"
            self.set_mood(target, "Back to watching")
        threading.Thread(target=restore_mood, daemon=True).start()

    def add_listener(self, queue):
        with self.lock:
            self.listeners.append(queue)

    def remove_listener(self, queue):
        with self.lock:
            if queue in self.listeners:
                self.listeners.remove(queue)

    def notify_change(self, event_type="update"):
        payload = json.dumps({"type": event_type, "status": self.get_status()})
        with self.lock:
            active_listeners = list(self.listeners)
        for q in active_listeners:
            try:
                q.put(payload)
            except Exception:
                pass

    def get_status(self):
        with self.lock:
            return {
                "mood": self.mood,
                "mood_reason": self.mood_reason,
                "one_liner": self.one_liner,
                "paired": self.paired,
                "active_request": self.active_request,
                "recent_events": self.recent_events[-10:],
                "has_bridge": HAS_BRIDGE,
                "demo_running": self.demo_running
            }

state = NudgeState()

class MCUBridgeHandler:
    def __init__(self):
        self.ready = HAS_BRIDGE
        if HAS_BRIDGE:
            try:
                bridge.register("on_mcu_event", self.on_mcu_event)
                print("[Bridge] Registered with Arduino RouterBridge")
            except Exception as e:
                print(f"[Bridge] RouterBridge init warning: {e}")
                self.ready = False

    def set_mood(self, mood):
        if not self.ready:
            return
        try:
            bridge.call("set_mood", mood)
        except Exception as e:
            print(f"[Bridge] Error sending mood to MCU: {e}")

    def on_mcu_event(self, raw_json):
        try:
            data = json.loads(raw_json)
            event_type = data.get("type")
            if event_type == "button":
                action = data.get("action")  # "allow" or "deny"
                print(f"[Bridge] Physical button pressed: {action.upper()}")
                handle_decision_from_hardware(action)
            elif event_type == "poke":
                print("[Bridge] Physical poke triggered")
                state.poke()
        except Exception as e:
            print(f"[Bridge] Error handling MCU event: {e}")

mcu_bridge = MCUBridgeHandler()

def handle_decision_from_hardware(action):
    """Called when user presses physical Allow or Deny button on the UNO Q."""
    with state.lock:
        req = state.active_request
        token = state.pairing_token
        laptop_url = state.laptop_url

    if not req:
        print("[Decision] Physical button pressed but no pending request.")
        state.set_mood("happy" if action == "allow" else "annoyed", f"Button pressed: {action}")
        return

    req_id = req.get("request_id")
    decision_val = "allow" if action == "allow" else "deny"

    # Forward decision to laptop sidecar if paired
    if laptop_url and token:
        forward_decision_to_laptop(laptop_url, token, req_id, decision_val, source="button")

    # Clear active request on board
    with state.lock:
        state.active_request = None
        state.one_liner = f"Approved {req.get('agent', 'agent')}" if action == "allow" else f"Denied {req.get('agent', 'agent')}"

    state.set_mood("happy" if action == "allow" else "annoyed", f"Decision {decision_val} applied")

def forward_decision_to_laptop(laptop_url, token, request_id, decision, source="button"):
    target_url = f"{laptop_url.rstrip('/')}/api/decision"
    payload = json.dumps({
        "token": token,
        "request_id": request_id,
        "decision": decision,
        "source": source
    }).encode("utf-8")

    def _post():
        try:
            req = urllib.request.Request(
                target_url,
                data=payload,
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                print(f"[Decision] Forwarded to laptop: {resp.status}")
        except Exception as e:
            print(f"[Decision] Warning forwarding to laptop {target_url}: {e}")

    threading.Thread(target=_post, daemon=True).start()

class GemmaTriage:
    """
    Gemma 4 integration running locally via App Lab's arduino:llm brick.
    Strictly validates model JSON output; drops unknown keys and unallowed tools.
    """
    SYSTEM_PROMPT = """You are Pip, a tiny, hyper-focused desk companion creature living inside an Arduino UNO Q.
You watch coding agent sessions (Cursor, Claude Code, Codex) from your desk.
You triage events for your human dev so they never miss an approval or get overwhelmed.

Given a session event, you MUST respond ONLY with a JSON object:
{
  "mood": "idle | peek | watching | needs_you | happy | annoyed | dizzy | asleep",
  "line": "<punchy 1-sentence summary under 40 chars>",
  "tools": [
    {"name": "request_approval", "args": {"request_id": "...", "summary": "...", "command": "..."}},
    {"name": "notify", "args": {"title": "...", "body": "..."}},
    {"name": "focus_session", "args": {}},
    {"name": "open_island", "args": {}}
  ]
}

Rules:
1. When kind is 'approval', mood MUST be 'needs_you', and you must invoke 'request_approval'.
2. When kind is 'step', mood should be 'watching'.
3. When kind is 'done', mood should be 'happy'.
4. Allowed tools are strictly: request_approval, notify, focus_session, open_island.
5. Never execute shell commands. Never ask for secrets or repos. Keep it cute, crisp, and safe.
"""

    @classmethod
    def evaluate(cls, event):
        """Call Gemma 4 via local LLM endpoint or use robust local triage logic."""
        prompt_user = json.dumps(event)
        raw_result = cls._call_llm(prompt_user)

        if raw_result:
            parsed = cls._parse_and_validate(raw_result, event)
            if parsed:
                return parsed

        # Fallback heuristic triage if LLM is offline or output is invalid
        return cls._fallback_triage(event)

    @classmethod
    def _call_llm(cls, user_msg):
        url = f"{LLM_BASE_URL.rstrip('/')}/chat/completions"
        payload = {
            "model": LLM_MODEL,
            "messages": [
                {"role": "system", "content": cls.SYSTEM_PROMPT},
                {"role": "user", "content": user_msg}
            ],
            "temperature": 0.2,
            "max_tokens": 256
        }
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=2.5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data["choices"][0]["message"]["content"]
        except Exception:
            return None

    @classmethod
    def _parse_and_validate(cls, text, event):
        try:
            # Strip markdown code blocks if present
            cleaned = text.strip()
            match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, re.DOTALL)
            if match:
                cleaned = match.group(1)
            else:
                json_start = cleaned.find("{")
                json_end = cleaned.rfind("}")
                if json_start != -1 and json_end != -1:
                    cleaned = cleaned[json_start:json_end+1]

            data = json.loads(cleaned)
            mood = data.get("mood", "watching")
            if mood not in ALLOWED_MOODS:
                mood = "watching"

            line = str(data.get("line", ""))[:80]

            validated_tools = []
            for t in data.get("tools", []):
                name = t.get("name")
                if name in ALLOWED_TOOLS:
                    args = t.get("args", {})
                    # Ensure request_approval preserves original request_id
                    if name == "request_approval":
                        args["request_id"] = event.get("request_id", args.get("request_id", ""))
                        args["command"] = str(event.get("command", args.get("command", "")))[:200]
                    validated_tools.append({"name": name, "args": args})

            return {"mood": mood, "line": line, "tools": validated_tools}
        except Exception:
            return None

    @classmethod
    def _fallback_triage(cls, event):
        kind = event.get("kind", "step")
        agent = event.get("agent", "agent")
        summary = event.get("summary", "")
        req_id = event.get("request_id", "")
        command = str(event.get("command", ""))[:200]

        if kind == "approval":
            return {
                "mood": "needs_you",
                "line": f"{agent.title()} wants permission: {summary[:40]}",
                "tools": [
                    {"name": "request_approval", "args": {"request_id": req_id, "summary": summary, "command": command}},
                    {"name": "open_island", "args": {}},
                    {"name": "notify", "args": {"title": "Nudge Approval", "body": summary}}
                ]
            }
        elif kind == "done":
            return {
                "mood": "happy",
                "line": f"{agent.title()} finished successfully!",
                "tools": []
            }
        elif kind == "question":
            return {
                "mood": "needs_you",
                "line": f"{agent.title()} asked a question",
                "tools": [{"name": "open_island", "args": {}}]
            }
        else:  # step or generic
            return {
                "mood": "watching",
                "line": f"{agent.title()}: {summary[:45]}",
                "tools": []
            }

    @classmethod
    def chat(cls, user_text):
        """Conversational chat with Pip."""
        chat_prompt = f"""You are Pip, the companion creature in Nudge. You live on an Arduino UNO Q desk board.
You are sweet, vigilant, slightly sassy when poked, and proud of guarding the dev's computer.
Respond briefly in 1-2 friendly sentences as Pip. Never break character.

Dev says: {user_text}
Pip:"""
        try:
            url = f"{LLM_BASE_URL.rstrip('/')}/chat/completions"
            payload = {
                "model": LLM_MODEL,
                "messages": [{"role": "user", "content": chat_prompt}],
                "temperature": 0.7,
                "max_tokens": 100
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data["choices"][0]["message"]["content"].strip()
        except Exception:
            responses = [
                "Pip is on duty! Desk guard operational and watching your agents! ◉‿◉",
                "Ready to slam that green Allow button whenever your agent needs us!",
                "*wiggles ears* Everything quiet on the terminal front. Keep coding!",
                "Don't worry, no wild commands get through without your physical sign-off!"
            ]
            import random
            return random.choice(responses)


def main():
    print("[Nudge] Gemma triage initialized")

if __name__ == "__main__":
    main()
