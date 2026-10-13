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


        self.show_all()
        if not HAS_LAYER_SHELL:
            self.reposition_window()

def main():
    Gtk.init(sys.argv)
    island = NudgeIsland()
    island.connect("destroy", Gtk.main_quit)
    Gtk.main()

if __name__ == "__main__":
    main()
