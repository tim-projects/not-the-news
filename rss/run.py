#!/usr/bin/env python3

import os
import sys
import time
import argparse
import subprocess
import shutil

# --- Paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

feed_dir = os.path.join(SCRIPT_DIR, "../data/feed/")
merged_file = os.path.join(feed_dir, "merged_feed.xml")
merged_log_file = os.path.join("/app/logs/", "merged_feeds.log")
filtered_file = os.path.join(feed_dir, "filtered_feed.xml")
final_feed_file = os.path.join(feed_dir, "feed.xml")


# --- Ensure feed directory exists ---
if not os.path.exists(feed_dir):
    os.makedirs(feed_dir, exist_ok=True)
    print(f"Directory created: {feed_dir}")
else:
    print(f"Directory already exists: {feed_dir}")

# helper to detect a running merge_feeds.py
def is_merge_running():
    """Return True if merge_feeds.py is already in the process list."""
    # pgrep -f looks for the full command line
    return (
        subprocess.run(
            ["pgrep", "-f", "merge_feeds.py"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode
        == 0
    )

def generate_feed():
    if is_merge_running():
        print("merge_feeds.py is already running; skipping this cycle.")
        return
    """Run the original pipeline via CLI scripts and sed replacements."""

    # 1) Merge
    with open(merged_log_file, "w") as log_file:
        process = subprocess.Popen(
            [
                "python3",
                "merge_feeds.py",
                "--output",
                merged_file,
            ],
            cwd=SCRIPT_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,  # to get strings instead of bytes
        )

        stdout, stderr = process.communicate() # Capture all output

        if stdout: # Only write if there's actual output
            log_file.write(stdout)

        if process.returncode != 0:
            raise subprocess.CalledProcessError(process.returncode, process.args)

    # 2) Filter
    subprocess.run(
        [
            "python3",
            "filter_feed.py",
            "--input",
            merged_file,
            "--output",
            filtered_file,
        ],
        check=True,
        cwd=SCRIPT_DIR,
    )

    # 3) Clean
    subprocess.run(
        [
            "python3",
            "clean_feed.py",
            "--input",
            filtered_file,
            "--output",
            final_feed_file,
        ],
        check=True,
        cwd=SCRIPT_DIR,
    )

    #    # 4) Post‐processing (same sed calls)
    #    subprocess.run(
    #        ['sed','-i','s/img src/img loading="lazy" src/g', final_feed_file],
    #        check=True
    #    )

    print("Feed updated successfully")

def main():
    parser = argparse.ArgumentParser(description="Not-the-News feed generator")
    parser.add_argument(
        "--daemon", action="store_true", help="Run continuously in daemon mode"
    )
    parser.add_argument(
        "--interval", type=int, default=300, help="Seconds between runs in daemon mode"
    )
    args = parser.parse_args()

    if args.daemon:
        print(f"Starting in daemon mode (interval={args.interval}s)")
        try:
            while True:
                generate_feed()
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("Daemon shutdown requested; exiting.")
            sys.exit(0)
    else:
        generate_feed()

if __name__ == "__main__":
    main()