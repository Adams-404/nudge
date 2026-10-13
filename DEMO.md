# Nudge: 60-Second Hackathon Judge Demo

This guide walks through the exact 60-second demo path for judges evaluating **Nudge** for Hacktoberfest Week 2 (*Side Hustle*), entering **Best Use of Arduino** and **Best Use of Gemma**.

---

## Prerequisites (Zero Configuration)
- **Arduino UNO Q** running App Lab (or desktop simulation).
- Python 3 on Linux (Fedora, Ubuntu, Arch).

---

## 60-Second Demo Path

```
  00:00 - 00:10   Import & Launch (App Lab ZIP)
  00:10 - 00:20   Meet Pip (Face, Poking, Local Gemma chat)
  00:20 - 00:30   Start Laptop Sidecar & Top-Edge Island
  00:30 - 00:45   Simulated Agent Session & Approval Trigger
  00:45 - 00:55   Physical Button Press & Celebration
  00:55 - 01:00   Recap (Privacy, Local Gemma, Physical Guard)
```

---

### Step 1: Import & Launch (00:00 - 00:10)
1. In Arduino App Lab, navigate to **Apps → Import Apps**.
2. Select `dist/nudge-applab.zip`.
3. Click **Run**.
4. Open the Web UI at `http://localhost:7000` (or `http://<board-ip>:7000`).
   * Pip appears on the screen in high-fps procedural Canvas 2D, his eyes tracking your cursor.
   * The UNO Q 12x8 LED matrix boots up showing Pip's smiling face.

---

### Step 2: Interactive Personality (00:10 - 00:20)
1. **Move your mouse:** Pip's pupils smoothly follow the cursor.
2. **Poke Pip:** Click Pip on the screen (or touch pin 4 on the board).
   * 1 click: Pip squishes with spring physics and gets `annoyed` (`- -` brows).
   * 3 rapid clicks: Pip wobbles side-to-side and gets `dizzy` (`X X` spinning eyes).
3. **Chat:** Click **Chat with Pip** and ask:
   > *"What do you do?"*
   * Gemma 3 1B on the board replies in character: *"Pip is on duty! Desk guard operational and watching your agents! ◉‿◉"*

---

### Step 3: Start Laptop Sidecar & Island (00:20 - 00:30)
In your laptop terminal:
```bash
python3 laptop/sidecar.py
```
* The sidecar displays your 6-digit PIN: `[ 275733 ]`.
* In Pip's Web UI, click **Pair Laptop**, enter `275733`, and click **Connect**.
* The status pill immediately turns green: **"Laptop Paired"**.

(Optional visual bonus): In a second terminal, launch the top-edge desktop island:
```bash
python3 laptop/island.py
```
A sleek black pill appears anchored to the top of your screen.

---

### Step 4: Fire the Agent Session (00:30 - 00:45)
In a third terminal, simulate a real coding session:
```bash
python3 laptop/demo_session.py
```
* **Step 1:** Cursor reads files → Pip switches to `watching` (focused eyes).
* **Step 2:** Cursor runs test suite → Pip updates one-liner: *"Cursor: Running pytest suite"*.
* **Step 3 (The Moment):** Cursor attempts to run `git push origin main`.
  * **Pip triggers `needs_you`!**
  * The LED matrix on the board starts pulsing.
  * The Web UI and Top-Edge Island display the amber Approval Card with the command snippet.

---

### Step 5: Physical Approval & Happy Reaction (00:45 - 00:55)
1. Press the **Physical Green Button** on your Arduino UNO Q (Pin 2) or click **Allow** in the UI.
2. What happens instantaneously:
   * The hook script unblocks and prints: `>>> [ALLOWED] Running 'git push origin main'... Done!`
   * Pip jumps into the air with joyful bouncing physics and a wide beaming grin (`happy`).
   * The LED matrix lights up with curved `^^` victory eyes!
   * The agent finishes cleanly with exit code 0.

---

### Step 6: 10-Second Pitch for Judges (00:55 - 01:00)
> *"This is Nudge. It solves coding agent anxiety by turning an ignored terminal prompt into a tangible, physical gate on your desk. Gemma 3 1B runs completely on the board, ensuring zero code or secrets ever touch a third-party cloud. Physical computing meets agentic AI."*
