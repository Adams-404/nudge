#!/usr/bin/env python3
"""
Nudge - App Lab ZIP Packaging Script
Packages the applab/ directory into dist/nudge-applab.zip ready for Arduino App Lab import.
"""

import os
import sys
import zipfile
import hashlib

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APPLAB_DIR = os.path.join(REPO_ROOT, "applab")
DIST_DIR = os.path.join(REPO_ROOT, "dist")
ZIP_OUT = os.path.join(DIST_DIR, "nudge-applab.zip")

REQUIRED_FILES = [
    "app.yaml",
    "python/main.py",
    "sketch/sketch.ino",
    "sketch/sketch.yaml",
    "assets/index.html",
    "assets/style.css",
    "assets/pip.js"
]

def check_files():
    print("[1/3] Verifying required App Lab files...")
    for rf in REQUIRED_FILES:
        full_p = os.path.join(APPLAB_DIR, rf)
        if not os.path.exists(full_p):
            print(f"ERROR: Missing required file: {rf}")
            sys.exit(1)
        print(f"  ✓ {rf} ({os.path.getsize(full_p)} bytes)")

def create_zip():
    print("\n[2/3] Building dist/nudge-applab.zip...")
    os.makedirs(DIST_DIR, exist_ok=True)
    if os.path.exists(ZIP_OUT):
        os.remove(ZIP_OUT)

    with zipfile.ZipFile(ZIP_OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(APPLAB_DIR):
            for file in files:
                # Exclude runtime cache and data
                if file.startswith(".") or file.endswith(".pyc") or "__pycache__" in root or "data" in root:
                    continue
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, APPLAB_DIR)
                z.write(full_path, arcname=rel_path)
                print(f"  + Added: {rel_path}")

    size_kb = os.path.getsize(ZIP_OUT) / 1024.0
    print(f"\nCreated: {ZIP_OUT} ({size_kb:.1f} KB)")

def print_checksum():
    print("\n[3/3] Generating SHA256 checksum...")
    sha = hashlib.sha256()
    with open(ZIP_OUT, "rb") as f:
        while chunk := f.read(65536):
            sha.update(chunk)
    digest = sha.hexdigest()
    print(f"SHA256: {digest}")
    
    # Save checksum file
    sha_file = ZIP_OUT + ".sha256"
    with open(sha_file, "w") as f:
        f.write(f"{digest}  nudge-applab.zip\n")
    print(f"Saved:   {sha_file}")

if __name__ == "__main__":
    check_files()
    create_zip()
    print_checksum()
    print("\nDone! Import nudge-applab.zip in Arduino App Lab (Apps -> Import Apps).")
