# @filepath: src/api.py

import os
import shutil
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

# Configure logging to stderr for Docker/Gunicorn compatibility
import sys
api_logger = logging.getLogger('api_logger')
api_logger.setLevel(logging.DEBUG)
handler = logging.StreamHandler(sys.stderr)
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)
api_logger.addHandler(handler)

api_logger.debug("DEBUG: api.py script started, logging to stderr.")


app = Flask(__name__)

app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)



# Keep Flask's default logger for general info/warnings, but use api_logger for specific debugs

app.logger.setLevel(logging.DEBUG) # Keep DEBUG for development, INFO for production

app.logger.handlers = [] # Remove existing handlers

app.logger.addHandler(handler) # Add the StreamHandler to Flask's app.logger

app.logger.info("Flask app logger configured to write to stderr.")  



DATA_DIR = "/data"

FEED_DIR = os.path.join(DATA_DIR, "feed")

CONFIG_DIR = os.path.join(DATA_DIR, "config")

USER_STATE_DIR = os.path.join(DATA_DIR, "user_state")



os.makedirs(DATA_DIR, exist_ok=True)

os.makedirs(FEED_DIR, exist_ok=True)

os.makedirs(CONFIG_DIR, exist_ok=True)

os.makedirs(USER_STATE_DIR, exist_ok=True)



FEED_XML = os.path.join(FEED_DIR, "feed.xml")



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

    'lastStateSync': {'type': 'simple', 'default': None},

    'lastViewedItemId': {'type': 'simple', 'default': None},

    'lastViewedItemOffset': {'type': 'simple', 'default': 0},

    'theme': {'type': 'simple', 'default': 'light'},

    'lastFeedSync': {'type': 'simple', 'default': None},

    'shuffledOutGuids': {'type': 'array', 'default': []},           # Array of { guid, shuffledAt }

    'rssFeeds': {'type': 'nested_object', 'default': {}},

    'keywordBlacklist': {'type': 'array', 'default': []},

}

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

def _user_state_path(key):
    return os.path.join(USER_STATE_DIR, f"{key}.json")

def _save_state(key, value):
    api_logger.debug(f"Attempting to save state for key: {key}")
    now = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    data = {"value": value, "lastModified": now}
    path = _user_state_path(key)
    try:
        json_content = json.dumps(data, indent=2)
        # For debugging, using a direct write instead of atomic write
        with open(path, 'w', encoding='utf-8') as f:
            f.write(json_content)
        api_logger.debug(f"Successfully saved state for key: {key}")
        return now
    except Exception as e:
        api_logger.exception(f"Error saving user state for key '{key}': {e}")
        raise

api_logger.info("Calling _seed_initial_configs() now...")
def _seed_initial_configs():
    api_logger.info("Inside _seed_initial_configs() function.")
    api_logger.info("Checking for initial config seeding...")

    # --- Seed RSS Feeds ---
    rss_feeds_json_dest_path = os.path.join(USER_STATE_DIR, "rssFeeds.json")
    rss_feeds_json_source_path = os.path.join(CONFIG_DIR, "rssFeeds.json")
    feeds_txt_source_path = os.path.join(CONFIG_DIR, "feeds.txt")

    if not os.path.exists(rss_feeds_json_dest_path):
        if os.path.exists(rss_feeds_json_source_path):
            api_logger.info(f"Seeding rssFeeds.json from {rss_feeds_json_source_path}...")
            try:
                shutil.copy(rss_feeds_json_source_path, rss_feeds_json_dest_path)
                api_logger.info(f"Successfully copied rssFeeds.json from config to user_state.")
            except Exception as e:
                api_logger.error(f"Failed to copy rssFeeds.json: {e}")
        elif os.path.exists(feeds_txt_source_path):
            api_logger.info(f"Seeding rssFeeds.json from {feeds_txt_source_path}...")
            try:
                with open(feeds_txt_source_path, 'r', encoding='utf-8') as f:
                    urls = [line.strip() for line in f if line.strip()]
                
                nested_feeds = {}
                default_category = "Miscellaneous"
                default_subcategory = "Default"
                nested_feeds[default_category] = {}
                nested_feeds[default_category][default_subcategory] = [{"url": url} for url in urls]
                
                _save_state("rssFeeds", nested_feeds)
                api_logger.info(f"Successfully seeded rssFeeds.json from feeds.txt.")
            except Exception as e:
                api_logger.error(f"Failed to seed rssFeeds.json from feeds.txt: {e}")
                api_logger.exception("Exception during rssFeeds seeding:")

    # --- Seed Keyword Blacklist ---
    keyword_blacklist_json_dest_path = os.path.join(USER_STATE_DIR, "keywordBlacklist.json")
    keyword_blacklist_json_source_path = os.path.join(CONFIG_DIR, "keywordBlacklist.json")
    keywords_txt_source_path = os.path.join(CONFIG_DIR, "filter_keywords.txt")

    if not os.path.exists(keyword_blacklist_json_dest_path):
        if os.path.exists(keyword_blacklist_json_source_path):
            api_logger.info(f"Seeding keywordBlacklist.json from {keyword_blacklist_json_source_path}...")
            try:
                shutil.copy(keyword_blacklist_json_source_path, keyword_blacklist_json_dest_path)
                api_logger.info(f"Successfully copied keywordBlacklist.json from config to user_state.")
            except Exception as e:
                api_logger.error(f"Failed to copy keywordBlacklist.json: {e}")
        elif os.path.exists(keywords_txt_source_path):
            api_logger.info(f"Seeding keywordBlacklist.json from {keywords_txt_source_path}...")
            try:
                with open(keywords_txt_source_path, 'r', encoding='utf-8') as f:
                    keywords = [line.strip() for line in f if line.strip()]
                
                _save_state("keywordBlacklist", keywords)
                api_logger.info(f"Successfully seeded keywordBlacklist.json from filter_keywords.txt.")
            except Exception as e:
                api_logger.error(f"Failed to seed keywordBlacklist.json from filter_keywords.txt: {e}")
                api_logger.exception("Exception during keywordBlacklist seeding:")

_seed_initial_configs() # Call seeding function early

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
        return jsonify({"error": "Internal server error"}), 500

def _load_feed_items():
    if not os.path.exists(FEED_XML):
        app.logger.warning(f"Failed to load feed.xml: File not found at {FEED_XML}")
        return {}

    try:
        with open(FEED_XML, 'r', encoding='utf-8') as f:
            feed_content = f.read()
        app.logger.debug(f"Read feed.xml content, length: {len(feed_content)}")
        root = ET.fromstring(feed_content)
        app.logger.debug("Successfully parsed feed.xml")
    except (FileNotFoundError, ET.ParseError) as e:
        app.logger.warning(f"Failed to load or parse feed.xml: {e}")
        api_logger.exception("Exception during feed XML loading:")
        return {}

    # Remove namespaces for easier parsing
    for elem in root.iter():
        if "}" in elem.tag:
            elem.tag = elem.tag.split("}", 1)[1]

    items = {}
    for it in root.findall(".//item"):
        guid = it.findtext("guid") or it.findtext("link")
        if not guid:
            app.logger.warning(f"Feed item missing GUID or Link, skipping.")
            continue

        raw_date = it.findtext("pubDate") or ""
        try:
            dt = parsedate_to_datetime(raw_date)
            pub_iso = dt.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        except Exception:
            pub_iso = raw_date

        description_element = it.find("description")
        description_content = ""
        if description_element is not None:
            # Preserve inner HTML of the description tag
            description_content = (description_element.text or '') + ''.join(
                ET.tostring(child, encoding='unicode') for child in description_element
            )

        unescaped_description = html.unescape(description_content.strip())

        data = {
            "guid": guid,
            "title": it.findtext("title"),
            "link": it.findtext("link"),
            "pubDate": pub_iso,
            "description": unescaped_description,
        }
        items[guid] = data
    app.logger.debug(f"Found {len(items)} items in feed.xml")
    return items

@app.route("/api/time", methods=["GET"])
def time():
    now = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    return jsonify({"time": now}), 200

@app.route("/api/feed-guids", methods=["GET"])
def feed_guids():
    items = _load_feed_items()
    latest_pub_date = None
    if items:
        try:
            pub_dates = [
                datetime.fromisoformat(item['pubDate'].replace('Z', '+00:00'))
                for item in items.values() if item.get('pubDate')
            ]
            if pub_dates:
                latest_pub_date = max(pub_dates)
        except (ValueError, TypeError):
            latest_pub_date = None

    last_modified_header = None
    if latest_pub_date:
        last_modified_header = latest_pub_date.strftime("%a, %d %b %Y %H:%M:%S GMT")

    if_modified_since = request.headers.get("If-Modified-Since")
    if if_modified_since and last_modified_header:
        try:
            ims_dt = datetime.strptime(if_modified_since, "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=timezone.utc)
            if latest_pub_date and latest_pub_date <= ims_dt:
                return make_response("", 304)
        except ValueError:
            pass 

    now = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    resp = jsonify({"guids": list(items.keys()), "serverTime": now})
    if last_modified_header:
        resp.headers["Last-Modified"] = last_modified_header
    return resp, 200

@app.route("/api/feed-items", methods=["GET", "POST"])
def feed_items():
    all_items = _load_feed_items()
    result_items = []

    if request.method == "GET":
        exclude_guids_param = request.args.get("exclude_guids", "")
        if exclude_guids_param:
            exclude_set = set(exclude_guids_param.split(","))
            result_items = [item for guid, item in all_items.items() if guid not in exclude_set]
        else:
            guids_param = request.args.get("guids", "")
            wanted_guids = guids_param.split(",") if guids_param else []
            result_items = [all_items[g] for g in wanted_guids if g in all_items]
    elif request.method == "POST":
        data = request.get_json(silent=True)
        wanted_guids = data.get("guids", []) if data else []
        result_items = [all_items[g] for g in wanted_guids if g in all_items]

    return jsonify(result_items), 200

def _load_state(key):
    api_logger.debug(f"Loading state for key: '{key}'")
    path = _user_state_path(key)
    api_logger.debug(f"State file path: {path}")

    if not os.path.exists(path):
        api_logger.warning(f"State file not found for key '{key}'. Creating with default.")
        default_data = USER_STATE_SERVER_DEFAULTS.get(key)
        if default_data:
            initial_value = default_data['default']
            try:
                last_modified = _save_state(key, initial_value)
                api_logger.debug(f"Created default state for '{key}' with value: {initial_value}")
                return {"value": initial_value, "lastModified": last_modified}
            except Exception as e:
                api_logger.exception(f"Failed to create initial state for '{key}': {e}")
                return {"value": None, "lastModified": None}
        api_logger.warning(f"No server default found for key '{key}'. Returning None.")
        return {"value": None, "lastModified": None}

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        api_logger.debug(f"Successfully loaded state for key '{key}'. Data: {data}")
        return data
    except (json.JSONDecodeError, KeyError, FileNotFoundError) as e:
        api_logger.exception(f"Error loading or decoding state file for key '{key}'. Returning None. Error: {e}")
        return {"value": None, "lastModified": None}

@app.route("/api/user-state/<key>", methods=["GET"])
def get_single_user_state_key(key):
    _authenticate_request()
    api_logger.debug(f"GET request for user state key: {key}")
    if not key:
        abort(400, description="User state key is required")
    state_data = _load_state(key)
    
    if state_data.get("value") is None and key not in USER_STATE_SERVER_DEFAULTS:
        api_logger.warning(f"Key '{key}' not found in user state or defaults.")
        abort(404, description=f"User state key '{key}' not found.")

    if_none_match = request.headers.get("If-None-Match")
    if state_data.get("lastModified") and if_none_match == state_data["lastModified"]:
        api_logger.debug(f"ETag match for key '{key}'. Returning 304 Not Modified.")
        return make_response("", 304)

    api_logger.debug(f"Returning state for key '{key}'.")
    resp = jsonify(state_data)
    if state_data.get("lastModified"):
        resp.headers["ETag"] = state_data["lastModified"]
    return resp, 200

@app.route("/api/user-state", methods=["POST"])
def post_user_state():
    api_logger.debug(f"POST request to /api/user-state. JSON: {request.get_json(silent=True)}")
    operations = request.get_json(silent=True)
    if not isinstance(operations, list):
        return jsonify({"error": "Invalid JSON body, expected a list of operations"}), 400

    results = []
    server_time = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

    for op in operations:
        op_type = op.get("type")
        op_id = op.get("id")
        key = op.get("key")
        try:
            if op_type == "simpleUpdate":
                if key not in USER_STATE_SERVER_DEFAULTS:
                    results.append({"id": op_id, "status": "skipped", "reason": "Unknown key"})
                    continue
                new_last_modified = _save_state(key, op.get("value"))
                results.append({"id": op_id, "key": key, "status": "success", "lastModified": new_last_modified})
            elif op_type in ["readDelta", "starDelta"]:
                target_key = "read" if op_type == "readDelta" else "starred"
                guid = op.get("guid")
                action = op.get("action")
                
                if not guid or not action:
                    results.append({"id": op_id, "status": "failed", "reason": "Missing guid or action for delta operation"})
                    continue

                state_data = _load_state(target_key)
                current_array = state_data.get("value", []) # Default to empty list
                
                if not isinstance(current_array, list): # Ensure it's a list
                    current_array = []

                new_array = [item for item in current_array if item.get("guid") != guid] # Remove existing entry for this guid

                if action == "add":
                    new_array.append({"guid": guid, "timestamp": datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')})
                
                new_last_modified = _save_state(target_key, new_array)
                results.append({"id": op_id, "key": target_key, "status": "success", "lastModified": new_last_modified})
            else:
                results.append({"id": op_id, "status": "skipped", "reason": "Unknown operation type"})
        except Exception as e:
            api_logger.exception(f"Error processing operation {op_type} for key {key}: {e}")
            results.append({"id": op_id, "status": "failed", "reason": str(e)})

    return jsonify({"status": "ok", "serverTime": server_time, "results": results}), 200

def _authenticate_request():
    auth_token = request.cookies.get("auth")
    if not auth_token:
        app.logger.warning("Authentication failed: No auth cookie.")
        abort(401, description="Authentication required.")
    
    # In a real application, you would validate this token against a session store or similar.
    # For this example, we assume presence implies validity after a successful login.
    # If the token was generated by `secrets.token_urlsafe(32)`, its existence is enough for this simple auth.
    return True # Authentication successful

@app.route("/api/admin/config-backup", methods=["GET"])
def config_backup():
    _authenticate_request()
    api_logger.info("Received request to backup application configuration.")

    try:
        all_user_settings = {}
        for key in USER_STATE_SERVER_DEFAULTS.keys():
            state_data = _load_state(key)
            # Only include if a value exists, and exclude metadata like lastModified
            if state_data.get("value") is not None:
                all_user_settings[key] = state_data["value"]
        
        api_logger.info("Successfully gathered all user settings for backup.")
        return jsonify(all_user_settings), 200

    except Exception as e:
        api_logger.exception(f"Error during configuration backup: {e}")
        return jsonify({"status": "error", "message": f"Failed to backup configuration: {str(e)}"}), 500

    except Exception as e:
        api_logger.exception(f"Error during configuration backup: {e}")
        return jsonify({"status": "error", "message": f"Failed to backup configuration: {str(e)}"}), 500

@app.route("/api/admin/config-restore", methods=["POST"])
def config_restore():
    _authenticate_request()
    api_logger.info("Received request to restore application configuration.")

    try:
        config_data = request.get_json()
        if not isinstance(config_data, dict):
            abort(400, description="Invalid JSON body, expected a dictionary of settings.")

        results = []
        for key, value in config_data.items():
            if key in USER_STATE_SERVER_DEFAULTS:
                new_last_modified = _save_state(key, value)
                results.append({"key": key, "status": "success", "lastModified": new_last_modified})
            else:
                api_logger.warning(f"Attempted to restore unknown key: {key}. Skipping.")
                results.append({"key": key, "status": "skipped", "reason": "Unknown key"})
        
        api_logger.info("Application configuration restored successfully.")
        return jsonify({"status": "ok", "message": "Configuration restored successfully.", "results": results}), 200

    except Exception as e:
        api_logger.exception(f"Error during configuration restoration: {e}")
        return jsonify({"status": "error", "message": f"Failed to restore configuration: {str(e)}"}), 500

@app.route("/api/admin/reset-app", methods=["POST"])
def reset_app_data():
    _authenticate_request()
    api_logger.info("Received request to reset application data.")

    try:
        files_to_delete = [
            "starred.json",
            "read.json",
            "currentDeckGuids.json",
            "shuffledOutGuids.json",
            "lastShuffleResetDate.json" # Also clear this so deck resets
        ]
        
        api_logger.debug("Attempting to clear specific user state files.")
        for filename in files_to_delete:
            file_path = os.path.join(USER_STATE_DIR, filename)
            if os.path.exists(file_path):
                os.remove(file_path)
                api_logger.debug(f"Deleted user state file: {file_path}")
            else:
                api_logger.debug(f"User state file not found: {file_path}")

        # Delete feed.xml
        api_logger.debug(f"Attempting to delete feed.xml at: {FEED_XML}")
        if os.path.exists(FEED_XML):
            os.remove(FEED_XML)
            api_logger.debug(f"Deleted feed.xml: {FEED_XML}")
        else:
            api_logger.debug(f"feed.xml not found: {FEED_XML}")

        # Do NOT re-seed initial configurations here.
        # rssFeeds and keywordBlacklist should persist.
        api_logger.info("Application data reset and re-seeded successfully.")
        return jsonify({"status": "ok", "message": "Application data reset successfully."}), 200

    except Exception as e:
        api_logger.exception(f"Error resetting application data: {e}")
        return jsonify({"status": "error", "message": f"Failed to reset application data: {str(e)}"}), 500

# The Flask development server is not used in the Docker container.
# It is served by Gunicorn.
# if __name__ == "__main__":
#     app.run(host="0.0.0.0", port=4575, debug=True)