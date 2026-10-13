#!/usr/bin/env python3
"""
Nudge - Top-Edge Island UI
Minimal, sleek desktop companion island for Linux (Wayland / X11).
Displays Pip's status and provides on-screen Allow / Deny approval cards.
"""

import sys
import os
import json
import time
import threading
import urllib.request
import urllib.error

# GUI: GTK 3.0 with LayerShell fallback
import gi
gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
from gi.repository import Gtk, Gdk, GLib

HAS_LAYER_SHELL = False
try:
    gi.require_version('GtkLayerShell', '0.1')
    from gi.repository import GtkLayerShell
    # Check if compositor actually supports layer shell
    if GtkLayerShell.is_supported():
        HAS_LAYER_SHELL = True
except Exception:
    HAS_LAYER_SHELL = False

SIDECAR_URL = os.environ.get("NUDGE_SIDECAR_URL", "http://127.0.0.1:7474")

CSS_DATA = b"""
window {
    background-color: transparent;
}

#island-container {
    background-color: rgba(10, 12, 16, 0.94);
    border: 1px solid rgba(240, 246, 252, 0.14);
    border-top: none;
    border-bottom-left-radius: 18px;
    border-bottom-right-radius: 18px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    padding: 6px 14px;
}

#status-pill {
    color: #f0f6fc;
    font-family: sans-serif;
    font-size: 12px;
    font-weight: 600;
}

#pip-icon {
    color: #38bdf8;
    font-size: 14px;
    font-weight: bold;
    margin-right: 6px;
}

#approval-box {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
}

#command-label {
    font-family: monospace;
    font-size: 11px;
    color: #38bdf8;
    background-color: rgba(0, 0, 0, 0.5);
    padding: 4px 8px;
    border-radius: 6px;
    margin-top: 4px;
    margin-bottom: 8px;
}

.btn-allow {
    background-color: #22c55e;
    color: #000000;
    font-weight: bold;
    font-size: 11px;
    border-radius: 8px;
    padding: 4px 12px;
    border: none;
}

.btn-deny {
    background-color: rgba(239, 68, 68, 0.2);
    color: #ef4444;
    font-weight: bold;
    font-size: 11px;
    border-radius: 8px;
    padding: 4px 12px;
    border: 1px solid rgba(239, 68, 68, 0.4);
}
"""

class NudgeIsland(Gtk.Window):
    def __init__(self):
        super().__init__(type=Gtk.WindowType.TOPLEVEL)

        self.active_request = None
        self.set_title("Nudge Island")
        self.set_decorated(False)
        self.set_resizable(False)
        self.set_keep_above(True)
        self.set_skip_taskbar_hint(True)
        self.set_skip_pager_hint(True)

        # Apply CSS
        css_provider = Gtk.CssProvider()
        css_provider.load_from_data(CSS_DATA)
        Gtk.StyleContext.add_provider_for_screen(
            Gdk.Screen.get_default(),
            css_provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        )

        # LayerShell or Dock Window
        if HAS_LAYER_SHELL:
            print("[Island] Initializing with GtkLayerShell (Wayland)")
            GtkLayerShell.init_for_window(self)
            GtkLayerShell.set_layer(self, GtkLayerShell.Layer.OVERLAY)
            GtkLayerShell.set_anchor(self, GtkLayerShell.Edge.TOP, True)
            GtkLayerShell.auto_exclusive_zone_enable(self)
        else:
            print("[Island] Initializing as Top Dock Overlay (GNOME/X11)")
            self.set_type_hint(Gdk.WindowTypeHint.DOCK)

        # UI Layout
        self.container = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        self.container.set_name("island-container")
        self.add(self.container)

        # Header Pill
        self.header_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        self.container.pack_start(self.header_box, False, False, 0)

        self.pip_icon = Gtk.Label(label="◉")
        self.pip_icon.set_name("pip-icon")
        self.header_box.pack_start(self.pip_icon, False, False, 0)

        self.status_label = Gtk.Label(label="Nudge • Standing by")
        self.status_label.set_name("status-pill")
        self.header_box.pack_start(self.status_label, False, False, 0)

        # Approval Card Details (Collapsed by default)
        self.approval_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        self.approval_box.set_name("approval-box")
        self.container.pack_start(self.approval_box, False, False, 0)

        self.summary_label = Gtk.Label(label="")
        self.summary_label.set_line_wrap(True)
        self.summary_label.set_max_width_chars(42)
        self.approval_box.pack_start(self.summary_label, False, False, 0)

        self.command_label = Gtk.Label(label="")
        self.command_label.set_name("command-label")
        self.command_label.set_line_wrap(True)
        self.command_label.set_max_width_chars(38)
        self.approval_box.pack_start(self.command_label, False, False, 0)

        # Buttons
        self.button_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.button_box.set_halign(Gtk.Align.CENTER)
        self.approval_box.pack_start(self.button_box, False, False, 0)

        self.btn_deny = Gtk.Button(label="Deny")
        self.btn_deny.get_style_context().add_class("btn-deny")
        self.btn_deny.connect("clicked", self.on_deny_clicked)
        self.button_box.pack_start(self.btn_deny, False, False, 0)

        self.btn_allow = Gtk.Button(label="Allow")
        self.btn_allow.get_style_context().add_class("btn-allow")
        self.btn_allow.connect("clicked", self.on_allow_clicked)
        self.button_box.pack_start(self.btn_allow, False, False, 0)

        self.approval_box.hide()
        self.show_all()
        self.approval_box.hide()

        # Center on top of screen if not layer-shell
        if not HAS_LAYER_SHELL:
            self.reposition_window()

        # Background polling thread
        self.running = True
        self.poll_thread = threading.Thread(target=self.poll_sidecar, daemon=True)
        self.poll_thread.start()

    def reposition_window(self):
        screen = Gdk.Screen.get_default()
        if screen:
            screen_w = screen.get_width()
            alloc = self.get_allocation()
            win_w = alloc.width if alloc.width > 1 else 280
            pos_x = (screen_w - win_w) // 2
            self.move(pos_x, 0)

    def on_allow_clicked(self, btn):
        if not self.active_request:
            return
        req_id = self.active_request.get("request_id")
        self.send_decision(req_id, "allow")

    def on_deny_clicked(self, btn):
        if not self.active_request:
            return
        req_id = self.active_request.get("request_id")
        self.send_decision(req_id, "deny")

    def send_decision(self, req_id, decision):
        url = f"{SIDECAR_URL.rstrip('/')}/api/decision"
        payload = json.dumps({
            "request_id": req_id,
            "decision": decision,
            "source": "island"
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
                print(f"[Island] Error sending decision: {e}")

        threading.Thread(target=_send, daemon=True).start()
        self.set_active_request(None)

    def set_active_request(self, req):
        self.active_request = req
        if req:
            agent = req.get("agent", "Agent").upper()
            summary = req.get("summary", "Approval requested")
            cmd = req.get("command", "")

            self.status_label.set_text(f"{agent} needs your approval")
            self.summary_label.set_text(summary)
            self.command_label.set_text(cmd if cmd else "(no command)")
            self.pip_icon.set_text("⚠️")
            self.approval_box.show_all()
        else:
            self.status_label.set_text("Nudge • Pip watching")
            self.pip_icon.set_text("◉")
            self.approval_box.hide()

        if not HAS_LAYER_SHELL:
            GLib.idle_add(self.reposition_window)

    def poll_sidecar(self):
        while self.running:
            try:
                req = urllib.request.Request(f"{SIDECAR_URL.rstrip('/')}/api/status")
                with urllib.request.urlopen(req, timeout=2.0) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    req_data = data.get("active_request")
                    GLib.idle_add(self.set_active_request, req_data)
            except Exception:
                pass
            time.sleep(1.0)

def main():
    Gtk.init(sys.argv)
    island = NudgeIsland()
    island.connect("destroy", Gtk.main_quit)
    Gtk.main()

if __name__ == "__main__":
    main()
