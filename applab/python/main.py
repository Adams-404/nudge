#!/usr/bin/env python3
"""
Nudge - Board Agent for Arduino UNO Q
Runs on the board's Linux MPU alongside local Gemma 3 1B (arduino:llm brick).

Responsibilities:
1. Web UI server on port 7000 (Pip character, chat, demo mode, approvals).
2. Laptop protocol on port 8766 (and 7000): session events, pairing, decisions.
3. Gemma 3 1B triage engine: analyzes agent hooks, outputs mood + strict tool JSON.
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
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
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

# LLM endpoint (default to App Lab's local llama.cpp / Gemma endpoint)
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://llamacpp-models-runner:9999/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "llamacpp:gemma-3-1b-it-Q4_0")

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
    Gemma 3 1B integration running locally via App Lab's arduino:llm brick.
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
        """Call Gemma 3 1B via local LLM endpoint or use robust local triage logic."""
        prompt_user = json.dumps(event)
        raw_result = cls._call_llm(prompt_user)

        if raw_result:
            parsed = cls._parse_and_validate(raw_result, event)
            if parsed:
                return parsed

        # Fallback heuristic triage if LLM is offline or output is invalid
        return cls._fallback_triage(event)

    # Candidate App Lab llama.cpp endpoints (container hostname first, then localhost fallbacks)
    CANDIDATE_URLS = [
        f"{LLM_BASE_URL.rstrip('/')}/chat/completions",
        "http://127.0.0.1:8080/v1/chat/completions",
        "http://127.0.0.1:9999/v1/chat/completions",
        "http://localhost:11434/v1/chat/completions",
        "http://llamacpp-models-runner:9999/v1/chat/completions"
    ]
    # Endpoint that last answered successfully, and hosts known to be unreachable
    _working_url = None
    _dead_hosts = {}
    DEAD_HOST_TTL = 60.0

    @classmethod
    def _host_of(cls, url):
        try:
            return urlparse(url).hostname or url
        except Exception:
            return url

    @classmethod
    def _is_dead(cls, url):
        host = cls._host_of(url)
        retry_at = cls._dead_hosts.get(host)
        if retry_at is None:
            return False
        if time.time() >= retry_at:
            cls._dead_hosts.pop(host, None)
            return False
        return True

    @classmethod
    def _mark_dead(cls, url):
        cls._dead_hosts[cls._host_of(url)] = time.time() + cls.DEAD_HOST_TTL

    @classmethod
    def _llm_urls(cls):
        urls = []
        if cls._working_url:
            urls.append(cls._working_url)
        for u in cls.CANDIDATE_URLS:
            if u not in urls:
                urls.append(u)
        return [u for u in urls if not cls._is_dead(u)]

    @classmethod
    def _post_chat(cls, url, payload, timeout):
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            cls._working_url = url
            return data["choices"][0]["message"]["content"]
        except Exception:
            # Endpoint unreachable or model unavailable: remember it so we
            # don't burn multi-second DNS/connection delays on every event.
            cls._mark_dead(url)
            return None

    @classmethod
    def _call_llm(cls, user_msg):
        payload = {
            "model": LLM_MODEL,
            "messages": [
                {"role": "system", "content": cls.SYSTEM_PROMPT},
                {"role": "user", "content": user_msg}
            ],
            "temperature": 0.2,
            "max_tokens": 256
        }
        for url in cls._llm_urls():
            content = cls._post_chat(url, payload, timeout=2.5)
            if content is not None:
                return content
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
        payload = {
            "model": LLM_MODEL,
            "messages": [{"role": "user", "content": chat_prompt}],
            "temperature": 0.7,
            "max_tokens": 100
        }
        for url in cls._llm_urls():
            reply = cls._post_chat(url, payload, timeout=3.0)
            if reply is not None:
                return reply.strip()
        responses = [
            "Pip is on duty! Desk guard operational and watching your agents! ◉‿◉",
            "Ready to slam that green Allow button whenever your agent needs us!",
            "*wiggles ears* Everything quiet on the terminal front. Keep coding!",
            "Don't worry, no wild commands get through without your physical sign-off!"
        ]
        import random
        return random.choice(responses)

class NudgeHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Concise logging
        pass

    def send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/status":
            self.send_json(200, state.get_status())
            return

        if path == "/api/stream":
            self.handle_sse()
            return

        # Serve static assets for Web UI
        if path == "/" or path == "":
            path = "/index.html"

        file_path = os.path.normpath(os.path.join(ASSETS_DIR, path.lstrip("/")))
        if os.path.commonpath([ASSETS_DIR, file_path]) == ASSETS_DIR and os.path.isfile(file_path):
            content_type = "text/plain"
            if file_path.endswith(".html"):
                content_type = "text/html"
            elif file_path.endswith(".css"):
                content_type = "text/css"
            elif file_path.endswith(".js"):
                content_type = "application/javascript"
            elif file_path.endswith(".svg"):
                content_type = "image/svg+xml"
            elif file_path.endswith(".png"):
                content_type = "image/png"

            try:
                with open(file_path, "rb") as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(content)))
                # Never let the browser cache the Web UI: after an App Lab
                # redeploy the JS/CSS must refresh immediately (a stale pip.js
                # otherwise keeps rendering the previous character).
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
                self.end_headers()
                self.wfile.write(content)
                return
            except Exception as e:
                self.send_json(500, {"error": str(e)})
                return

        self.send_json(404, {"error": "Not found"})

    def handle_sse(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        import queue
        q = queue.Queue()
        state.add_listener(q)

        # Send initial status
        initial_msg = json.dumps({"type": "init", "status": state.get_status()})
        self.wfile.write(f"data: {initial_msg}\n\n".encode("utf-8"))
        self.wfile.flush()

        try:
            while True:
                try:
                    msg = q.get(timeout=20.0)
                    self.wfile.write(f"data: {msg}\n\n".encode("utf-8"))
                    self.wfile.flush()
                except queue.Empty:
                    # Keep-alive heartbeat
                    self.wfile.write(b": heartbeat\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            state.remove_listener(q)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        data = {}
        if body:
            try:
                data = json.loads(body.decode("utf-8"))
            except Exception:
                self.send_json(400, {"error": "Invalid JSON"})
                return

        # 1. Pairing Handshake
        if path == "/api/pair":
            token = data.get("token")
            laptop_url = data.get("laptop_url")
            code = data.get("code")

            if laptop_url and code:
                # Reach out to laptop sidecar to verify code and exchange session token
                try:
                    pair_payload = json.dumps({"code": code, "board_url": f"http://localhost:{PORT_WEB}"}).encode("utf-8")
                    req = urllib.request.Request(
                        f"{laptop_url.rstrip('/')}/api/pair",
                        data=pair_payload,
                        headers={"Content-Type": "application/json"}
                    )
                    with urllib.request.urlopen(req, timeout=3.0) as resp:
                        res_data = json.loads(resp.read().decode("utf-8"))
                        token = res_data.get("token", token)
                except Exception as e:
                    print(f"[Pair] Warning contacting laptop sidecar: {e}")

            if not token:
                token = str(uuid.uuid4())

            state.save_pairing(token, laptop_url)
            print(f"[Pair] Paired with laptop sidecar at {laptop_url}")
            self.send_json(200, {"status": "paired", "token": token})
            return

        # 2. Unpair
        if path == "/api/unpair":
            state.unpair()
            self.send_json(200, {"status": "unpaired"})
            return

        # 3. Session Event from Laptop Sidecar
        if path == "/api/event":
            # Security verification
            token = data.get("token")
            if state.paired and state.pairing_token and token != state.pairing_token:
                self.send_json(401, {"error": "Unauthorized token"})
                return

            event = data.get("event", {})
            self.process_event(event)
            self.send_json(200, {"status": "accepted"})
            return

        # 4. User Decision from Web UI or Island
        if path == "/api/decision":
            req_id = data.get("request_id")
            decision = data.get("decision")  # "allow", "deny", "always"
            source = data.get("source", "web_ui")

            with state.lock:
                req = state.active_request
                token = state.pairing_token
                laptop_url = state.laptop_url

            if req and req.get("request_id") == req_id:
                if laptop_url and token:
                    forward_decision_to_laptop(laptop_url, token, req_id, decision, source=source)
                with state.lock:
                    state.active_request = None
                new_mood = "happy" if decision in ["allow", "always"] else "annoyed"
                state.set_mood(new_mood, f"Decision {decision} applied by {source}")
                state.notify_change("decision")
                self.send_json(200, {"status": "ok", "decision": decision})
            else:
                self.send_json(404, {"error": "Request ID not waiting or already resolved"})
            return

        # 5. Interactive Poke
        if path == "/api/poke":
            state.poke()
            self.send_json(200, {"status": "poked", "mood": state.mood})
            return

        # 6. Interactive Chat with Pip / Gemma 3 1B
        if path == "/api/chat":
            user_msg = data.get("message", "")
            reply = GemmaTriage.chat(user_msg)
            with state.lock:
                state.chat_history.append({"role": "user", "text": user_msg})
                state.chat_history.append({"role": "pip", "text": reply})
            state.notify_change("chat")
            self.send_json(200, {"reply": reply})
            return

        # 7. Demo Mode Trigger
        if path == "/api/demo":
            threading.Thread(target=run_demo_simulation, daemon=True).start()
            self.send_json(200, {"status": "demo_started"})
            return

        self.send_json(404, {"error": "Not found"})

    def process_event(self, event):
        """Pass event through Gemma 3 1B triage and apply mood and tools."""
        with state.lock:
            state.recent_events.append(event)
            if len(state.recent_events) > 30:
                state.recent_events = state.recent_events[-30:]

        triage = GemmaTriage.evaluate(event)
        mood = triage.get("mood", "watching")
        line = triage.get("line", "")
        tools = triage.get("tools", [])

        with state.lock:
            state.one_liner = line

        # Execute validated tools
        for tool in tools:
            name = tool.get("name")
            args = tool.get("args", {})
            if name == "request_approval":
                with state.lock:
                    state.active_request = {
                        "request_id": args.get("request_id"),
                        "summary": args.get("summary"),
                        "command": args.get("command"),
                        "agent": event.get("agent", "cursor"),
                        "project": event.get("project", "workspace"),
                        "timestamp": time.time()
                    }
                print(f"[Approval Required] {state.active_request['summary']} ({state.active_request['command']})")

        state.set_mood(mood, line)

def run_demo_simulation():
    """Scripted 60-second judge demo showing complete end-to-end flow."""
    with state.lock:
        if state.demo_running:
            return
        state.demo_running = True

    print("[Demo] Starting Nudge demo simulation sequence...")
    try:
        # 1. Wake up
        state.set_mood("peek", "Pip spots a new coding agent starting...")
        time.sleep(2.0)

        # 2. Agent inspects code
        event_1 = {
            "kind": "step",
            "agent": "cursor",
            "summary": "Inspecting repository architecture and git status",
            "project": "nudge",
            "request_id": ""
        }
        triage_1 = GemmaTriage.evaluate(event_1)
        state.set_mood(triage_1["mood"], triage_1["line"])
        time.sleep(2.5)

        # 3. Agent runs tests
        event_2 = {
            "kind": "step",
            "agent": "cursor",
            "summary": "Running pytest suite (34 passed)",
            "project": "nudge",
            "request_id": ""
        }
        triage_2 = GemmaTriage.evaluate(event_2)
        state.set_mood(triage_2["mood"], triage_2["line"])
        time.sleep(2.5)

        # 4. Agent requests permission
        demo_req_id = "demo-" + str(uuid.uuid4())[:8]
        event_3 = {
            "kind": "approval",
            "agent": "cursor",
            "request_id": demo_req_id,
            "summary": "Cursor wants to run git push origin main",
            "command": "git push origin main",
            "project": "nudge"
        }
        triage_3 = GemmaTriage.evaluate(event_3)
        with state.lock:
            state.active_request = {
                "request_id": demo_req_id,
                "summary": "Cursor wants to run git push origin main",
                "command": "git push origin main",
                "agent": "cursor",
                "project": "nudge",
                "timestamp": time.time()
            }
        state.set_mood("needs_you", "Physical approval needed for git push!")
        
        # Give judges 5 seconds to click or tap Allow, or auto-allow if left unattended
        wait_start = time.time()
        while time.time() - wait_start < 5.0:
            with state.lock:
                if state.active_request is None:
                    break
            time.sleep(0.5)

        # If still waiting, auto-simulate approval click
        with state.lock:
            if state.active_request:
                state.active_request = None
                print("[Demo] Auto-simulating physical Allow button press")

        # 5. Happy reaction
        state.set_mood("happy", "Approval granted! Agent pushing code!")
        time.sleep(3.0)

        # 6. Done
        event_4 = {
            "kind": "done",
            "agent": "cursor",
            "summary": "Git push complete! Changes live.",
            "project": "nudge"
        }
        triage_4 = GemmaTriage.evaluate(event_4)
        state.set_mood(triage_4["mood"], triage_4["line"])
        time.sleep(3.0)

        # 7. Settle to idle
        state.set_mood("idle", "All quiet. Pip standing by.")
    finally:
        with state.lock:
            state.demo_running = False
        state.notify_change("demo_finished")

def run_server(port):
    server = ThreadingHTTPServer(("0.0.0.0", port), NudgeHandler)
    print(f"[Nudge] Serving on http://0.0.0.0:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

def main():
    print(r"""
  _  _          _            
 | \| | _  _ __| |__ _ ___  
 | .` || || / _` / _` / -_) 
 |_|\_| \_,_\__,_\__, \___| 
                 |___/     
 Nudge: Gemma 3 1B Desk Companion for Coding Agents
""")
    print(f"Platform: {'UNO Q (Bridge Active)' if HAS_BRIDGE else 'Desktop / Standalone Mode'}")
    print(f"Web UI: http://localhost:{PORT_WEB}")
    print(f"API Port: http://localhost:{PORT_API}")
    print(f"Local Gemma Endpoint: {LLM_BASE_URL} ({LLM_MODEL})")

    # Start primary Web server
    t_web = threading.Thread(target=run_server, args=(PORT_WEB,), daemon=True)
    t_web.start()

    # If API port is different, start API listener as well
    if PORT_API != PORT_WEB:
        t_api = threading.Thread(target=run_server, args=(PORT_API,), daemon=True)
        t_api.start()

    # Keep main alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[Nudge] Shutting down Pip agent.")

if __name__ == "__main__":
    main()
