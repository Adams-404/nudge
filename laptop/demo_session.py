#!/usr/bin/env python3
"""
Nudge - Demo Session Simulator
Simulates a live Cursor / Claude Code session sending real hook calls to the laptop sidecar.
Walks through inspection, test execution, and triggers a real approval request
that can be allowed via physical UNO Q button, Web UI, or Top-Edge Island!
"""

import sys
import os
import time
import json
import uuid
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
HOOK_BIN = os.path.join(SCRIPT_DIR, "hooks", "nudge-hook")

def run_hook(event):
    cmd = [HOOK_BIN, json.dumps(event)]
    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.returncode

def main():
    print("==================================================")
    print("  Nudge Demo: Simulated Coding Agent Session      ")
    print("==================================================")
    print("Starting agent session: 'Refactor auth middleware'...\n")

    # Step 1: Reading files
    print("[1/4] Cursor reading src/auth/jwt.py and routes.py...")
    run_hook({
        "kind": "step",
        "agent": "cursor",
        "summary": "Reading authentication handler and route decorators",
        "project": "nudge"
    })
    time.sleep(2.0)

    # Step 2: Running tests
    print("[2/4] Cursor executing test suite: pytest tests/test_auth.py...")
    run_hook({
        "kind": "step",
        "agent": "cursor",
        "summary": "Running pytest suite (12 passed, 0 failed)",
        "project": "nudge"
    })
    time.sleep(2.0)

    # Step 3: Trigger Approval
    req_id = "req-" + str(uuid.uuid4())[:8]
    print(f"\n[3/4] [PROMPT] Cursor wants to run:")
    print("      $ git push origin main --tags")
    print(f"      Request ID: {req_id}")
    print("\n>>> WAITING FOR DECISION:")
    print("    - Press GREEN BUTTON on Arduino UNO Q")
    print("    - OR click 'Allow' in Laptop Top-Edge Island")
    print("    - OR click 'Allow' on Web UI (http://localhost:7000)\n")

    code = run_hook({
        "kind": "approval",
        "agent": "cursor",
        "request_id": req_id,
        "summary": "Cursor wants to push release tags to remote",
        "command": "git push origin main --tags",
        "project": "nudge"
    })

    if code == 0:
        print("\n>>> [ALLOWED] Physical button / Island decision received!")
        print("    Running 'git push origin main --tags'... Done!\n")
        time.sleep(1.0)
        # Step 4: Done
        print("[4/4] Agent session completed successfully!")
        run_hook({
            "kind": "done",
            "agent": "cursor",
            "summary": "Session completed. Code pushed successfully.",
            "project": "nudge"
        })
    else:
        print("\n>>> [DENIED] Command was rejected by user.")
        run_hook({
            "kind": "step",
            "agent": "cursor",
            "summary": "Push aborted. Standing down.",
            "project": "nudge"
        })

    print("\nDemo session finished.")

if __name__ == "__main__":
    main()
