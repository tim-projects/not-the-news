import re
import os
import json
import secrets
import logging, html
import tempfile
from flask import Flask, request, jsonify, abort, make_response
from datetime import datetime, timezone
from xml.etree import ElementTree as ET
from email.utils import parsedate_to_datetime
from werkzeug.middleware.proxy_fix import ProxyFix
from logging.handlers import RotatingFileHandler
import textwrap # Re-import textwrap

file_path = '/app/src/api.py' # Changed to absolute path for container

# Define _atomic_write function directly in reconstruct_api.py
def _atomic_write(filepath, content, mode='w', encoding='utf-8'):
    '''
    Writes content to a file in an atomic way.
    It writes to a temporary file first and then renames it.
    '''
    dir_name, file_name = os.path.split(filepath)
    with tempfile.NamedTemporaryFile(mode=mode, encoding=encoding, delete=False, dir=dir_name, prefix=f"{file_name}.") as temp_file:
        try:
            temp_file.write(content)
            temp_file.flush()
            os.fsync(temp_file.fileno())
            temp_path = temp_file.name
        except Exception:
            os.unlink(temp_file.name)
            raise
    os.rename(temp_path, filepath)


# Read the entire content of the file
with open(file_path, 'r') as f:
    original_content = f.read()

# --- Define the correct function bodies using textwrap.dedent ---
# Ensure internal docstrings use a different quote style than the outer textwrap.dedent string.
# Using """ for outer textwrap.dedent, so internal docstrings will use '''
atomic_write_correct_body = textwrap.dedent("""
def _atomic_write(filepath, content, mode='w', encoding='utf-8'):
    '''
    Writes content to a file in an atomic way.
    It writes to a temporary file first and then renames it.
    '''
    dir_name, file_name = os.path.split(filepath)
    with tempfile.NamedTemporaryFile(mode=mode, encoding=encoding, delete=False, dir=dir_name, prefix=f"{file_name}.") as temp_file:
        try:
            temp_file.write(content)
            temp_file.flush()
            os.fsync(temp_file.fileno())
            temp_path = temp_file.name
        except Exception:
            os.unlink(temp_file.name)
            raise
    os.rename(temp_path, filepath)""")

user_state_path_correct_body = textwrap.dedent("""
def _user_state_path(key):
    return os.path.join(USER_STATE_DIR, f"{key}.json")""")

save_state_correct_body = textwrap.dedent("""
def _save_state(key, value):
    now = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    data = {"value": value, "lastModified": now}
    path = _user_state_path(key)
    try:
        json_content = json.dumps(data, indent=2)
        _atomic_write(path, json_content)
        return now
    except Exception as e:
        app.logger.exception(f"Error saving user state for key '{key}': {e}")
        raise""")

seed_initial_configs_block_correct = textwrap.dedent("""
app.logger.info("Calling _seed_initial_configs() now...")
def _seed_initial_configs():
    app.logger.info("Inside _seed_initial_configs() function.")
    app.logger.info("Checking for initial config seeding...")

    # --- Seed RSS Feeds ---
    rss_feeds_json_dest_path = os.path.join(USER_STATE_DIR, "rssFeeds.json")
    rss_feeds_json_source_path = os.path.join(CONFIG_DIR, "rssFeeds.json")
    feeds_txt_source_path = os.path.join(CONFIG_DIR, "feeds.txt")

    if not os.path.exists(rss_feeds_json_dest_path):
        if os.path.exists(rss_feeds_json_source_path):
            app.logger.info(f"Seeding rssFeeds.json from {rss_feeds_json_source_path}...")
            try:
                shutil.copy(rss_feeds_json_source_path, rss_feeds_json_dest_path)
                app.logger.info(f"Successfully copied rssFeeds.json from config to user_state.")
            except Exception as e:
                app.logger.error(f"Failed to copy rssFeeds.json: {e}")
        elif os.path.exists(feeds_txt_source_path):
            app.logger.info(f"Seeding rssFeeds.json from {feeds_txt_source_path}...")
            try:
                with open(feeds_txt_source_path, 'r', encoding='utf-8') as f:
                    urls = [line.strip() for line in f if line.strip()]
                
                nested_feeds = {}
                default_category = "Miscellaneous"
                default_subcategory = "Default"
                nested_feeds[default_category] = {}
                nested_feeds[default_category][default_subcategory] = [{"url": url} for url in urls]
                
                _save_state("rssFeeds", nested_feeds)
                app.logger.info(f"Successfully seeded rssFeeds.json from feeds.txt.")
            except Exception as e:
                app.logger.error(f"Failed to seed rssFeeds.json from feeds.txt: {e}")
                app.logger.exception("Exception during rssFeeds seeding:")

    # --- Seed Keyword Blacklist ---
    keyword_blacklist_json_dest_path = os.path.join(USER_STATE_DIR, "keywordBlacklist.json")
    keyword_blacklist_json_source_path = os.path.join(CONFIG_DIR, "keywordBlacklist.json")
    keywords_txt_source_path = os.path.join(CONFIG_DIR, "filter_keywords.txt")

    if not os.path.exists(keyword_blacklist_json_dest_path):
        if os.path.exists(keyword_blacklist_json_source_path):
            app.logger.info(f"Seeding keywordBlacklist.json from {keyword_blacklist_json_source_path}...")
            try:
                shutil.copy(keyword_blacklist_json_source_path, keyword_blacklist_json_dest_path)
                app.logger.info(f"Successfully copied keywordBlacklist.json from config to user_state.")
            except Exception as e:
                app.logger.error(f"Failed to copy keywordBlacklist.json: {e}")
        elif os.path.exists(keywords_txt_source_path):
            app.logger.info(f"Seeding keywordBlacklist.json from {keywords_txt_source_path}...")
            try:
                with open(keywords_txt_source_path, 'r', encoding='utf-8') as f:
                    keywords = [line.strip() for line in f if line.strip()]
                
                _save_state("keywordBlacklist", keywords)
                app.logger.info(f"Successfully seeded keywordBlacklist.json from filter_keywords.txt.")
            except Exception as e:
                app.logger.error(f"Failed to seed keywordBlacklist.json from filter_keywords.txt: {e}")
                app.logger.exception("Exception during keywordBlacklist seeding:")

_seed_initial_configs() # Call seeding function early""")

# Define the full and correct USER_STATE_SERVER_DEFAULTS block
USER_STATE_SERVER_DEFAULTS_CORRECT_BODY = textwrap.dedent("""
USER_STATE_SERVER_DEFAULTS = {
    'currentDeckGuids': {'type': 'array', 'default': []},          # Array of { guid, addedAt }
    'lastShuffleResetDate': {'type': 'simple', 'default': None},
    'shuffleCount': {'type': 'simple', 'default': 2},
    'openUrlsInNewTabEnabled': {'type': 'simple', 'default': True},
    'starred': {'type': 'array', 'default': []},               # Array of { guid, starredAt }
    'hidden': {'type': 'array', 'default': []},                # Array of { guid, hiddenAt }
    'read': {'type': 'array', 'default': []},                 # Array of { guid, readAt }
    'filterMode': {'type': 'simple', 'default': 'unread'},
    'syncEnabled': {'type': 'simple', 'default': True},
    'imagesEnabled': {'type': 'simple', 'default': True},
    'fontSize': {'type': 'simple', 'default': 100},
    'lastStateSync': {'type': 'simple', 'default': None},
    'lastViewedItemId': {'type': 'simple', 'default': None},
    'lastViewedItemOffset': {'type': 'simple', 'default': 0},
    'theme': {'type': 'simple', 'default': 'light'},
    'themeStyle': {'type': 'simple', 'default': 'original'},
    'themeStyleLight': {'type': 'simple', 'default': 'original'},
    'themeStyleDark': {'type': 'simple', 'default': 'original'},
    'lastFeedSync': {'type': 'simple', 'default': None},
    'shuffledOutGuids': {'type': 'array', 'default': []},           # Array of { guid, shuffledAt }
    'rssFeeds': {'type': 'nested_object', 'default': {}},
    'keywordBlacklist': {'type': 'array', 'default': []},
    'customCss': {'type': 'simple', 'default': ''},
    'shadowsEnabled': {'type': 'simple', 'default': True},
}""")

# Define the full and correct login function body with the decorator
login_function_correct = textwrap.dedent('''
@app.route("/api/login", methods=["POST"])
def login():
    try:
        if not request.is_json:
            app.logger.warning("Login: Missing JSON in request")
            return jsonify({"error": "Missing JSON in request"}), 400
        data = request.get_json()
        submitted_pw = data.get("password")
        if not submitted_pw:
            app.logger.warning("Login: Password not provided")
            return jsonify({"error": "Password required"}), 400

        app_password = os.environ.get("APP_PASSWORD")

        if not app_password:
            app.logger.error("Login: Server misconfigured, APP_PASSWORD not set")
            return jsonify({"error": "Server misconfigured"}), 500

        if submitted_pw != app_password:
            app.logger.info("Login: Invalid password attempt")
            return jsonify({"error": "Invalid password"}), 401

        auth_token = secrets.token_urlsafe(32)
        resp = make_response(jsonify({"status": "ok"}))
        resp.set_cookie("auth", auth_token, max_age=90*24*60*60, httponly=True, secure=True, samesite="Strict", path="/")
        app.logger.info("Login: Successful authentication")
        return resp
    except Exception as e:
        app.logger.exception(f"Login error: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500''')

# Use markers for easier identification and replacement
USER_STATE_DEFAULTS_START_MARKER = "USER_STATE_SERVER_DEFAULTS ="
LOGIN_DEF_MARKER = "def login():"
LOGIN_FUNCTION_START_REGEX = r"(?:@app\.route\(.*\)\s+)*def login\(\):" # Regex to find login func including optional decorators

# Find the start of USER_STATE_SERVER_DEFAULTS
start_defaults = original_content.find(USER_STATE_DEFAULTS_START_MARKER)

# Find the full login function block to replace
login_match = re.search(LOGIN_FUNCTION_START_REGEX, original_content)

if start_defaults != -1 and login_match:
    # Extract content before the defaults
    before_defaults = original_content[:start_defaults]

    # Extract content after the login function
    after_login_func = original_content[login_match.end():]

    # The content between defaults and login func, before any fix/replacement occurs
    # Need to be careful here to ensure we capture everything between the end of defaults
    # and the start of login_match, excluding existing definitions of _atomic_write, etc.

    # Pattern to find and remove old definitions of utility functions for clean insertion
    remove_patterns = [
        re.compile(r"""def _atomic_write\(filepath,.*?(?=\n(?:def\s\w+\(|\n@app\.route|\nif __name__ == "__main__":))""", re.DOTALL),
        re.compile(r"""def _user_state_path\(key\).*?(?=\n(?:def\s\w+\(|\n@app\.route|\nif __name__ == "__main__":))""", re.DOTALL),
        re.compile(r"""def _save_state\(key, value\).*?(?=\n(?:def\s\w+\(|\n@app\.route|\nif __name__ == "__main__":))""", re.DOTALL),
        re.compile(r"""app\.logger\.info\("Calling _seed_initial_configs\(\)"\).*?_seed_initial_configs\(\) # Call seeding function early.*?(?=\n(?:def\s\w+\(|\n@app\.route|\nif __name__ == "__main__":))""", re.DOTALL)
    ]
    
    # Apply replacements iteratively starting from the section after defaults up to login func
    temp_content_middle = original_content[original_content.find(USER_STATE_DEFAULTS_START_MARKER) : login_match.start()]
    
    # Remove existing definitions from the 'middle' section if they are malformed/old
    for pattern in remove_patterns:
        temp_content_middle = pattern.sub('', temp_content_middle)

    # Clean up any leftover empty lines after removals
    temp_content_middle = re.sub(r'\n{2,}', '\n', temp_content_middle).strip()


    reconstructed_content = (
        before_defaults +
        USER_STATE_SERVER_DEFAULTS_CORRECT_BODY + '\n\n' +
        user_state_path_correct_body + '\n\n' +
        save_state_correct_body + '\n\n' +
        seed_initial_configs_block_correct + '\n\n' +
        login_function_correct + '\n\n' +
        # Re-add the content from after the original login function but after all the fixes/insertions
        original_content[login_match.end():]
    )

    # Clean up excess newlines after the full reconstruction
    reconstructed_content = re.sub(r'\n{3,}', '\n\n', reconstructed_content)
else:
    # Fallback if markers are not found, something is seriously wrong with the original file content.
    logging.warning("Markers for USER_STATE_SERVER_DEFAULTS or login function not found. Aborting reconstruction.")
    reconstructed_content = original_content


print(f"Successfully reconstructed {file_path}")