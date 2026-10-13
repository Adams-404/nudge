#!/usr/bin/env python3
"""
Nudge Safety & Integration Test Suite
Non-destructive test suite to verify hardware safety, App Lab zip validity,
security protocols, and the end-to-end agent approval loop.
"""

import os
import sys
import json
import time
import zipfile
import hashlib
import subprocess
import urllib.request
import urllib.error
import unittest

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APPLAB_DIR = os.path.join(PROJECT_DIR, "applab")
SKETCH_INO = os.path.join(APPLAB_DIR, "sketch", "sketch.ino")
ZIP_FILE = os.path.join(PROJECT_DIR, "dist", "nudge-applab.zip")
SHA_FILE = os.path.join(PROJECT_DIR, "dist", "nudge-applab.zip.sha256")

class HardwareSafetyAudit(unittest.TestCase):
    """Verifies that the MCU firmware is strictly non-destructive and electrically safe."""

    def test_pin_modes_are_safe_pullups(self):
        """Pins 2, 3, 4 MUST be INPUT_PULLUP to prevent floating states and short circuits."""
        self.assertTrue(os.path.exists(SKETCH_INO), "sketch.ino must exist")
        with open(SKETCH_INO, "r") as f:
            code = f.read()

        self.assertIn("pinMode(PIN_BTN_ALLOW, INPUT_PULLUP);", code, "Allow button must use INPUT_PULLUP")
        self.assertIn("pinMode(PIN_BTN_DENY,  INPUT_PULLUP);", code, "Deny button must use INPUT_PULLUP")
        self.assertIn("pinMode(PIN_BTN_POKE,  INPUT_PULLUP);", code, "Poke button must use INPUT_PULLUP")
        # Ensure no raw OUTPUT writes on the user pushbuttons
        self.assertNotIn("pinMode(PIN_BTN_ALLOW, OUTPUT);", code)
        self.assertNotIn("pinMode(PIN_BTN_DENY, OUTPUT);", code)
        self.assertNotIn("pinMode(PIN_BTN_POKE, OUTPUT);", code)

    def test_no_destructive_firmware_calls(self):
        """Firmware must not touch low-level bootloader/EEPROM writes."""
        with open(SKETCH_INO, "r") as f:
            code = f.read()

        forbidden_keywords = ["EEPROM.write", "flash_write", "bootloader", "NVIC_SystemReset"]
        for kw in forbidden_keywords:
            self.assertNotIn(kw, code, f"Forbidden dangerous keyword '{kw}' found in sketch")

    def test_debounce_timing_is_present(self):
        """Debounce timer must prevent hardware contact bounce and spam."""
        with open(SKETCH_INO, "r") as f:
            code = f.read()
        self.assertIn("DEBOUNCE_MS", code)
        self.assertIn("lastAllowPressTime", code)

    def test_led_matrix_frames_match_unoq_hardware(self):
        """UNO Q matrix is 8x13 (104 LEDs): frames must be uint8_t[104] drawn
        via matrix.draw(). The 12x8 uint32_t[3] / loadFrame() layout (UNO R4
        style) reads past the frame buffer on this hardware."""
        with open(SKETCH_INO, "r") as f:
            code = f.read()
        self.assertIn("const uint8_t FRAME_IDLE[104]", code)
        self.assertNotIn("loadFrame", code)
        self.assertIn("matrix.draw(FRAME_", code)
        self.assertIn("setGrayscaleBits(1)", code)
        # Every FRAME_* definition must hold exactly 104 values (macros expand to 13)
        import re
        macros = {
            "ROW0":  [0] * 13,
            "EYE_L": [0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0],
            "LIDS":  [0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0],
            "SMILE": [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
            "MOUTH": [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
        }
        for name, body in re.findall(r"const uint8_t (FRAME_\w+)\[104\] = \{(.*?)\};", code, re.DOTALL):
            values = []
            for tok in body.replace(",", " ").split():
                if tok in macros:
                    values += macros[tok]
                else:
                    values.append(int(tok))
            self.assertEqual(len(values), 104, f"{name} must be a 104-byte 8x13 frame")

    def test_sketch_declares_pinned_routerbridge_libraries(self):
        """App Lab cannot resolve bare library names; sketch.yaml must pin
        RouterBridge and its transitive dependencies (Arduino_LED_Matrix ships
        inside the zephyr core and must NOT be listed)."""
        sketch_yaml = os.path.join(APPLAB_DIR, "sketch", "sketch.yaml")
        with open(sketch_yaml, "r") as f:
            cfg = f.read()
        self.assertIn("Arduino_RouterBridge (", cfg)
        self.assertIn("Arduino_RPClite (", cfg)
        self.assertIn("MsgPack (", cfg)
        self.assertNotIn("Arduino_LED_Matrix", cfg)


class AppLabZipIntegrity(unittest.TestCase):
    """Verifies the importable App Lab zip archive structure and checksum."""

    def test_zip_exists_and_matches_checksum(self):
        self.assertTrue(os.path.exists(ZIP_FILE), "dist/nudge-applab.zip must exist")
        self.assertTrue(os.path.exists(SHA_FILE), "dist/nudge-applab.zip.sha256 must exist")

        with open(SHA_FILE, "r") as f:
            expected_sha = f.read().split()[0]

        hasher = hashlib.sha256()
        with open(ZIP_FILE, "rb") as f:
            while chunk := f.read(65536):
                hasher.update(chunk)
        actual_sha = hasher.hexdigest()

        self.assertEqual(expected_sha, actual_sha, "ZIP SHA-256 checksum mismatch")

    def test_zip_contains_all_applab_components(self):
        with zipfile.ZipFile(ZIP_FILE, "r") as z:
            names = set(z.namelist())

        required = {
            "app.yaml",
            "python/main.py",
            "sketch/sketch.ino",
            "sketch/sketch.yaml",
            "assets/index.html",
            "assets/style.css",
            "assets/pip.js"
        }
        for item in required:
            self.assertIn(item, names, f"App Lab zip missing {item}")


class SecurityProtocolVerification(unittest.TestCase):
    """Verifies security controls: token auth, command truncation, bound request_id."""

    @classmethod
    def setUpClass(cls):
        cls.board_port = 7088
        cls.api_port = 8788
        cls.sidecar_port = 7488

        env_board = {
            **os.environ,
            "NUDGE_WEB_PORT": str(cls.board_port),
            "NUDGE_API_PORT": str(cls.api_port)
        }
        env_sidecar = {
            **os.environ,
            "NUDGE_SIDECAR_PORT": str(cls.sidecar_port),
            "NUDGE_BOARD_URL": f"http://127.0.0.1:{cls.board_port}"
        }

        cls.p_board = subprocess.Popen(
            [sys.executable, os.path.join(PROJECT_DIR, "applab", "python", "main.py")],
            env=env_board,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        cls.p_sidecar = subprocess.Popen(
            [sys.executable, os.path.join(PROJECT_DIR, "laptop", "sidecar.py")],
            env=env_sidecar,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        time.sleep(1.5)

    @classmethod
    def tearDownClass(cls):
        cls.p_board.terminate()
        cls.p_sidecar.terminate()
        cls.p_board.wait(timeout=2.0)
        cls.p_sidecar.wait(timeout=2.0)

    def test_01_board_status_endpoint(self):
        """Board status must return valid Pip state."""
        url = f"http://127.0.0.1:{self.board_port}/api/status"
        with urllib.request.urlopen(url) as r:
            self.assertEqual(r.status, 200)
            data = json.loads(r.read())
            self.assertIn("mood", data)
            self.assertIn("one_liner", data)

    def test_02_poke_interaction(self):
        """Poking Pip triggers annoyed or dizzy mood."""
        url = f"http://127.0.0.1:{self.board_port}/api/poke"
        req = urllib.request.Request(url, data=b"{}", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as r:
            self.assertEqual(r.status, 200)
            data = json.loads(r.read())
            self.assertIn(data.get("mood"), ["annoyed", "dizzy"])

    def test_03_pairing_handshake_and_token_exchange(self):
        """Pairing via 6-digit PIN securely synchronizes session tokens."""
        # 1. Fetch sidecar PIN
        with urllib.request.urlopen(f"http://127.0.0.1:{self.sidecar_port}/api/status") as r:
            s_data = json.loads(r.read())
            pin = s_data["pairing_code"]

        # 2. Submit PIN to board
        pair_url = f"http://127.0.0.1:{self.board_port}/api/pair"
        payload = json.dumps({"code": pin, "laptop_url": f"http://127.0.0.1:{self.sidecar_port}"}).encode()
        req = urllib.request.Request(pair_url, data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as r:
            self.assertEqual(r.status, 200)
            b_pair = json.loads(r.read())
            self.assertEqual(b_pair.get("status"), "paired")
            self.assertTrue(len(b_pair.get("token", "")) > 10)

    def test_04_unauthorized_token_rejection(self):
        """Board drops session events sent with forged or mismatched token."""
        event_url = f"http://127.0.0.1:{self.board_port}/api/event"
        bad_payload = json.dumps({
            "token": "malicious-fake-token",
            "event": {"kind": "step", "summary": "test"}
        }).encode()
        req = urllib.request.Request(event_url, data=bad_payload, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                self.fail("Should have raised HTTP 401 Unauthorized")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 401)

    def test_05_stale_request_id_rejection(self):
        """Decisions for unknown or expired request_ids are safely rejected."""
        dec_url = f"http://127.0.0.1:{self.board_port}/api/decision"
        payload = json.dumps({
            "request_id": "non-existent-stale-id",
            "decision": "allow"
        }).encode()
        req = urllib.request.Request(dec_url, data=payload, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                self.fail("Should have rejected stale request_id")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 404)

    def test_06_end_to_end_approval_loop(self):
        """Hook blocks on approval request and unblocks with exit 0 upon allow decision."""
        req_id = "test-req-safe-1"
        hook_cmd = [
            os.path.join(PROJECT_DIR, "laptop", "hooks", "nudge-hook"),
            json.dumps({
                "kind": "approval",
                "agent": "cursor",
                "request_id": req_id,
                "summary": "Cursor wants to deploy",
                "command": "git push origin main"
            })
        ]
        hook_env = {**os.environ, "NUDGE_SIDECAR_URL": f"http://127.0.0.1:{self.sidecar_port}/hook"}

        # Launch hook in subprocess
        p_hook = subprocess.Popen(hook_cmd, env=hook_env)

        # Poll for the board to pick up the request (LLM triage can take
        # seconds on the real UNO Q, so never rely on a fixed sleep).
        deadline = time.time() + 10.0
        st = None
        while time.time() < deadline:
            with urllib.request.urlopen(f"http://127.0.0.1:{self.board_port}/api/status") as r:
                st = json.loads(r.read())
            if st.get("mood") == "needs_you" and st.get("active_request"):
                break
            time.sleep(0.2)
        self.assertEqual(st.get("mood"), "needs_you")
        self.assertIsNotNone(st.get("active_request"))

        # Send Allow decision from board
        dec_url = f"http://127.0.0.1:{self.board_port}/api/decision"
        payload = json.dumps({"request_id": req_id, "decision": "allow", "source": "button"}).encode()
        req = urllib.request.Request(dec_url, data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as r:
            self.assertEqual(r.status, 200)

        # Hook must exit cleanly with code 0
        exit_code = p_hook.wait(timeout=3.0)
        self.assertEqual(exit_code, 0, "Hook should have exited with code 0 (Allowed)")


if __name__ == "__main__":
    unittest.main(verbosity=2)
