---
title: "Nudge: Meet Pip, Your Physical Desk Companion for Coding Agents (Powered by Gemma 3 1B & Arduino UNO Q)"
published: false
description: "A physical desk buddy for Cursor, Claude Code, and Codex. Gemma 3 1B runs locally on an Arduino UNO Q; an Allow/Deny button on your desk guards your code."
tags: hacktoberfest, arduino, gemma, ai
cover_image: https://raw.githubusercontent.com/Adams-404/nudge/main/assets/cover.png
canonical_url: https://github.com/Adams-404/nudge
---

*Submitting for Hacktoberfest Week 2: **Side Hustle** (Due Oct 18, 2026)*  
*Categories Entered:*
- 🏆 **Best Use of Arduino** (Arduino UNO Q, MPU Linux + Zephyr MCU, RouterBridge RPC, 13x8 LED Matrix, physical Allow/Deny buttons, importable App Lab App).
- 🏆 **Best Use of Gemma** (Gemma 3 1B running locally on-board via `arduino:llm` / llama.cpp, strict validated tool calling JSON, zero-cloud privacy architecture).

---

## 1. The Problem: "The Tabbed-Away Agent Dilemma"

If you code with autonomous agents like Cursor, Claude Code, Codex, or Gemini CLI, you know this exact pain:

1. You give the agent a prompt: *"Refactor our payment models and run the test suite."*
2. It starts working. You don't want to stare at terminal progress bars for 3 minutes, so you switch to Slack, email, or browser tabs.
3. 20 seconds later, the agent stops. It wants permission to execute `git checkout -b fix-auth` or `npm test`.
4. **You don't notice.** The terminal sits frozen for 15 minutes waiting for your approval.
5. Your flow state is shattered, your momentum is gone, and you’ve wasted half an hour babysitting a terminal tab.

Alternatively, developers get frustrated and turn on "Auto-Approve" / `yolo mode`—which inevitably leads to wiped git stashes or accidental commits pushed directly to `main`.

What if your coding agent had a **physical desk companion**? A tactile, smiling little guardian sitting next to your coffee cup whose LED face pulses when permission is needed, and whose physical green button on your desk allows the command with a satisfying tactile click?

Meet **Nudge**, and his physical resident, **Pip**.

---

## 2. The Product: Desk Brain + Laptop Hands

Nudge is an original dual-system product:

- **On your desk:** An **Arduino UNO Q** running Arduino App Lab. The Linux MPU runs **Gemma 3 1B locally** alongside an interactive Web UI on port 7000. The Zephyr MCU drives a 13x8 LED-matrix face and listens for physical button inputs.
- **On your laptop:** A featherweight background daemon and a sleek Wayland/X11 top-edge island. It intercepts hook events from Claude Code or Cursor, sanitizes them, and holds permission requests until a decision arrives.

```
       LAPTOP                                ARDUINO UNO Q
 ┌─────────────────┐                     ┌────────────────────────┐
 │  Cursor/Claude  │                     │  Linux MPU (App Lab)   │
 │   Agent Hook    │                     │  ┌──────────────────┐  │
 └────────┬────────┘                     │  │ Gemma 3 1B (Local)  │  │
          │ JSON                         │  │  Triage Engine   │  │
          ▼                              │  └────────┬─────────┘  │
 ┌─────────────────┐    LAN POST         │           │ Tool JSON  │
 │  Nudge Sidecar  │────────────────────▶│  ┌────────▼─────────┐  │
 │  (Port 7474)    │                     │  │   Python Agent   │  │
 └────────┬────────┘                     │  └────────┬─────────┘  │
          │                              │           │ RPC        │
          │ Stale-proof                  │  ┌────────▼─────────┐  │
          │ Request ID                   │  │   MCU (Bridge)   │  │
          │                              │  │ 13x8 LED Matrix  │  │
          ▼                              │  │  Physical Green  │  │
 ┌─────────────────┐                     │  │   Allow Button   │  │
 │ Top-Edge Island │                     │  └──────────────────┘  │
 └─────────────────┘                     └────────────────────────┘
```

---

## 3. Why Local Gemma 3 1B on the Board? (Privacy by Physics)

Sending your proprietary codebase or raw terminal command logs to a 3rd-party cloud LLM just to show a desktop notification is an unacceptable security risk for many teams.

**Nudge is local-first and privacy-preserving:**

1. **Gemma 3 1B Runs on the Board:** Using the Arduino App Lab `arduino:llm` brick, Gemma 3 1B (~700 MB in Q4_0) executes entirely on the UNO Q's hardware via llama.cpp.
2. **Summaries, Not Secrets:** The laptop sidecar strips environmental variables and truncates commands to 200 characters before transmitting.
3. **Strict Validated Tool Calling:** Gemma 3 1B acts as a **character + triage engine**. Python validates its output against a strict JSON schema:

```json
{
  "mood": "needs_you",
  "line": "Cursor wants git push",
  "tools": [
    {"name": "request_approval", "args": {"request_id": "...", "command": "git push"}},
    {"name": "notify", "args": {"title": "Nudge", "body": "Needs you"}},
    {"name": "open_island", "args": {}}
  ]
}
```

Any arbitrary shell command or unrecognized tool returned by the model is immediately dropped. Gemma can **never** execute arbitrary shell commands on your computer.

---

## 4. Hardware Deep-Dive: Arduino UNO Q & RouterBridge

The Arduino UNO Q features a dual-core architecture: a high-level Linux MPU paired with an ultra-responsive Zephyr MCU.

In Nudge, we use the `Arduino_RouterBridge` library to bridge the two worlds:

```cpp
// applab/sketch/sketch.ino
#include "Arduino_LED_Matrix.h"
#include "Arduino_RouterBridge.h"

ArduinoLEDMatrix matrix;
const int PIN_BTN_ALLOW = 2; // Physical Green Button
const int PIN_BTN_DENY  = 3; // Physical Red Button

void setup() {
    pinMode(PIN_BTN_ALLOW, INPUT_PULLUP);
    pinMode(PIN_BTN_DENY, INPUT_PULLUP);
    matrix.begin();
    Bridge.begin();
    Bridge.provide("set_mood", rpc_set_mood);
}

void loop() {
    if (digitalRead(PIN_BTN_ALLOW) == LOW && isDebounced()) {
        Bridge.call("on_mcu_event", "{\"type\":\"button\",\"action\":\"allow\"}");
    }
}
```

When Python on the Linux MPU receives an agent hook, it calls `Bridge.call("set_mood", "needs_you")`. The MCU immediately starts pulsing the 13x8 LED matrix face. When you slap the green button, the MCU notifies Python, which transmits an atomic decision back to your laptop.

---

## 5. The Side Hustle Pitch: Would Devs Pay For This?

Hacktoberfest Week 2's theme is **Side Hustle**. Could Nudge be a viable developer hardware product?

**Absolutely.** Here is why:

- **The Desk Companion Craze:** From Cyberpunk status monitors to Tidbyt displays, developers love physical desk accessories that reflect their digital state.
- **Agent Fatigue is Growing:** As coding agents become the standard workflow for senior engineers, the cognitive friction of alt-tabbing to approve `git push` or `pytest` is palpable.
- **The Hardware Kit:** An injection-molded acrylic case shaped like Pip, an Arduino UNO Q preloaded with Nudge and Gemma 3 1B, and two arcade-grade mechanical pushbuttons. Devs gladly pay $69–$99 for ergonomic and desk-productivity hardware that saves 15 minutes of context-switching daily.
- **Open Standards:** Because Nudge imports as a standard `.zip` via Arduino App Lab, anyone can customize Pip's expressions, add new sensors (like an ultrasonic distance sensor that wakes Pip up when you sit down), or change the triage prompt.

---

## 6. How to Try It (In 60 Seconds)

We built Nudge so judges can experience the full magic without installing agent hooks or buying hardware:

1. **Grab the Repo:**
   ```bash
   git clone https://github.com/Adams-404/nudge.git
   cd nudge
   ```
2. **Launch the Board Agent:**
   ```bash
   python3 applab/python/main.py
   # Opens Web UI on http://localhost:7000 with procedural Canvas 2D Pip!
   ```
3. **Launch the Laptop Sidecar:**
   ```bash
   python3 laptop/sidecar.py
   ```
4. **Trigger the 60s Demo:**
   Click **Try 60s Demo** in Pip's Web UI or run `python3 laptop/demo_session.py`.
   - Watch Pip transition from `idle` to `watching`.
   - Watch the amber Approval Card pop up when Cursor requests `git push`.
   - Click **Allow** (or press the UNO Q button).
   - Watch Pip do a joyful victory jump (`happy`) while your agent completes!

---

## 7. What We Learned

- **Small Models Can Be Brilliant Character Actors:** You don't need a 70B parameter monster to build a delightful AI agent. Gemma 3 1B is fast, runs on embedded hardware, and when given tight JSON schema constraints, excels at contextual triage.
- **Tactile Feedback Beats Screen Notifications:** There is something profoundly satisfying about physically slapping a real button on your desk to push code to GitHub. It restores agency and intentionality to autonomous workflows.

Check out the code, import the App Lab zip, and let us know what you think:  
👉 [GitHub Repository: Adams-404/nudge](https://github.com/Adams-404/nudge)

*Special thanks to Louis Raillé's [Coucou](https://github.com/Louis-CFM/coucou) for inspiring the companion concept!*
