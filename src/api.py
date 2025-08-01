from flask import Flask, request, jsonify, abort, make_response
from datetime import datetime, timezone
from xml.etree import ElementTree as ET
from email.utils import parsedate_to_datetime
from werkzeug.middleware.proxy_fix import ProxyFix
import os
import json
import secrets
import logging
import html

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
#app.logger.setLevel(logging.INFO) # This was commented out, keep it commented if you want DEBUG by default

app.logger.setLevel(logging.DEBUG) # Keep DEBUG for development, INFO for production

DATA_DIR = "/data"
FEED_DIR = os.path.join(DATA_DIR, "feed")
CONFIG_DIR = os.path.join(DATA_DIR, "config")
USER_STATE_DIR = os.path.join(DATA_DIR, "user_state")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(FEED_DIR, exist_ok=True)
os.makedirs(CONFIG_DIR, exist_ok=True)
os.makedirs(USER_STATE_DIR, exist_ok=True)

# --- START OF CHANGES ---
# CORRECTED: Changed the path to point to the file inside the feed directory.
FEED_XML = os.path.join(FEED_DIR, "feed.xml")

# This is the original path you were using, which caused the problem.
# FEED_XML = "/data/feed.xml"
# --- END OF CHANGES ---

USER_STATE_SERVER_DEFAULTS = {
    # Client keys map directly to filenames
    'currentDeckGuids': {'type': 'array', 'default': []},
    'lastShuffleResetDate': {'type': 'simple', 'default': None},
    'shuffleCount': {'type': 'simple', 'default': 2},
    'openUrlsInNewTabEnabled': {'type': 'simple', 'default': True},
    'starred': {'type': 'array', 'default': []}, # Array of { guid, starredAt }
    'hidden': {'type': 'array', 'default': []},   # Array of { guid, hiddenAt }
    'filterMode': {'type': 'simple', 'default': 'unread'},
    'syncEnabled': {'type': 'simple', 'default': True},
    'imagesEnabled': {'type': 'simple', 'default': True},
    'lastStateSync': {'type': 'simple', 'default': None},
    'lastViewedItemId': {'type': 'simple', 'default': None}, # This should be a GUID
    'lastViewedItemOffset': {'type': 'simple', 'default': 0},
    'theme': {'type': 'simple', 'default': 'light'},
    'lastFeedSync': {'type': 'simple', 'default': None},
    'shuffledOutGuids': {'type': 'array', 'default': []},
    'rssFeeds': {'type': 'array', 'default': []},
    'keywordBlacklist': {'type': 'array', 'default': []},
}

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
    app.logger.debug("Attempting to parse feed.xml")

    if not os.path.exists(FEED_XML):
        app.logger.warning(f"Failed to load feed.xml: File not found at {FEED_XML}")
        return {}

    try:
        with open(FEED_XML, 'r', encoding='utf-8') as f:
            feed_content = f.read()
            # Log the first 500 characters of the raw XML content
            app.logger.debug(f"Full feed content read from disk (first 500 chars): {feed_content[:500]}...")
        tree = ET.fromstring(feed_content)
        app.logger.debug("Successfully parsed feed.xml")
    except (FileNotFoundError, ET.ParseError, ET.ParseError) as e:
        app.logger.warning(f"Failed to load or parse feed.xml: {e}")
        return {}

    root = tree.getroot()
    # Remove namespaces for easier parsing
    for elem in root.iter():
        if "}" in elem.tag:
            elem.tag = elem.tag.split("}", 1)[1]

    items = {}
    for it in root.findall(".//item"):
        guid = it.findtext("guid") or it.findtext("link")
        if not guid:
            app.logger.warning(f"Feed item missing GUID or Link: {ET.tostring(it, encoding='unicode')}")
            continue

        raw_date = it.findtext("pubDate") or ""
        try:
            dt = parsedate_to_datetime(raw_date)
            # Ensure consistent ISO format with 'Z' for UTC
            pub_iso = dt.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        except Exception:
            pub_iso = raw_date

        # Get the description and unescape HTML entities
        description = it.findtext("description")
        if description:
            description = html.unescape(description)

        # Log the raw description we just found
        app.logger.debug(f"Processing item with GUID: {guid}")
        app.logger.debug(f"Raw description: {description}")

        data = {
            "guid": guid,
            "title": it.findtext("title"),
            "link": it.findtext("link"),
            "pubDate": pub_iso,
            "description": description,
        }
        items[guid] = data
    return items

@app.route("/api/time", methods=["GET"])
def time():
    """Returns the current UTC time in ISO format."""
    now = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    app.logger.debug(f"Time requested: {now}")
    return jsonify({"time": now}), 200

@app.route("/api/feed-guids", methods=["GET"])
def feed_guids():
    """
    Returns a list of all item GUIDs from the feed and the server's current time.
    Supports If-Modified-Since header to return 304 Not Modified if feed hasn't changed.
    """
    items = _load_feed_items()

    # Determine the latest pubDate from loaded items
    latest_pub_date = None
    for item in items.values():
        pub_date_str = item.get('pubDate')
        if pub_date_str:
            try:
                # Parse and convert to UTC for comparison
                dt = datetime.fromisoformat(pub_date_str.replace('Z', '+00:00')).astimezone(timezone.utc)
                if latest_pub_date is None or dt > latest_pub_date:
                    latest_pub_date = dt
            except ValueError:
                app.logger.warning(f"Invalid pubDate format for item {item.get('guid')}: {pub_date_str}")
                continue

    # Format latest_pub_date for Last-Modified header (RFC 1123 format)
    last_modified_header = None
    if latest_pub_date:
        last_modified_header = latest_pub_date.strftime("%a, %d %b %Y %H:%M:%S GMT")

    # Check If-Modified-Since header
    if_modified_since = request.headers.get("If-Modified-Since")
    if if_modified_since and last_modified_header:
        try:
            # Parse If-Modified-Since date
            ims_dt = datetime.strptime(if_modified_since, "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=timezone.utc)
            if latest_pub_date and latest_pub_date <= ims_dt:
                app.logger.info("Feed GUIDs: Returning 304 Not Modified (If-Modified-Since matched).")
                return make_response("", 304)
        except ValueError:
            app.logger.warning(f"Invalid If-Modified-Since header format: {if_modified_since}")

    now = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

    resp = jsonify({"guids": list(items.keys()), "serverTime": now})
    if last_modified_header:
        resp.headers["Last-Modified"] = last_modified_header

    app.logger.info(f"Returning {len(items)} GUIDs with server time.")
    return resp, 200

@app.route("/api/feed-items", methods=["GET", "POST"])
def feed_items():
    """
    Returns full item data for specified GUIDs (POST) or all items excluding
    certain GUIDs (GET with exclude_guids).
    GET:
        guids (comma-separated query param): Specific GUIDs to retrieve.
        exclude_guids (comma-separated query param): GUIDs to exclude from the full feed.
                       If exclude_guids is present, 'guids' param is ignored.
    POST:
        JSON body with {"guids": ["guid1", "guid2"]}.
    """
    all_items = _load_feed_items()
    result_items = []

    if request.method == "GET":
        exclude_guids_param = request.args.get("exclude_guids", "")
        if exclude_guids_param:
            exclude_set = set(exclude_guids_param.split(","))
            app.logger.info(f"GET /api/feed-items: Excluding {len(exclude_set)} GUIDs.")
            result_items = [item for guid, item in all_items.items() if guid not in exclude_set]
        else:
            guids_param = request.args.get("guids", "")
            wanted_guids = guids_param.split(",") if guids_param else []
            app.logger.info(f"GET /api/feed-items: Fetching {len(wanted_guids)} specific GUIDs.")
            result_items = [all_items[g] for g in wanted_guids if g in all_items]

    elif request.method == "POST":
        data = request.get_json(silent=True)
        wanted_guids = data.get("guids", []) if data else []
        app.logger.info(f"POST /api/feed-items: Fetching {len(wanted_guids)} specific GUIDs.")
        result_items = [all_items[g] for g in wanted_guids if g in all_items]

    # --- START OF NEW DEBUG LOG ---
    # Log the first item in the list that is about to be sent
    if result_items:
        first_item = result_items[0]
        app.logger.debug(f"Pre-jsonify check: First item to be sent has description length: {len(first_item.get('description', ''))}")
        app.logger.debug(f"Pre-jsonify check: First item description starts with: '{first_item.get('description', '')[:50]}...'")
    # --- END OF NEW DEBUG LOG ---
    
    app.logger.info(f"Returning {len(result_items)} items.")
    return jsonify(result_items), 200

def _user_state_path(key):
    """Constructs the full file path for a given user state key."""
    return os.path.join(USER_STATE_DIR, f"{key}.json")

def _load_state(key):
    """
    Loads a single user state key, returning its value and last modification timestamp.
    If the file does not exist, it initializes it with a default value and saves it.
    """
    path = _user_state_path(key)
    app.logger.debug(f"Attempting to load user state file: {path}")

    if not os.path.exists(path):
        app.logger.info(f"User state file not found for key '{key}' at '{path}'. Attempting to initialize with default.")

        default_data = USER_STATE_SERVER_DEFAULTS.get(key)
        if default_data:
            initial_value = default_data['default']
            try:
                app.logger.info(f"Initializing user state file for key '{key}' with default value: {initial_value}")
                now_utc = datetime.now(timezone.utc).isoformat(timespec='milliseconds') + 'Z'
                initial_state = {"value": initial_value, "lastModified": now_utc}
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(initial_state, f, indent=2)
                app.logger.info(f"Successfully initialized user state file for key '{key}'.")
                return initial_state
            except Exception as e:
                app.logger.exception(f"Error initializing user state file for key '{key}' at '{path}': {e}")
                return {"value": None, "lastModified": None}
        else:
            app.logger.warning(f"Key '{key}' not found in USER_STATE_SERVER_DEFAULTS. Cannot initialize. Returning default (None).")
            return {"value": None, "lastModified": None}

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

            last_modified = data.get("lastModified")
            if last_modified:
                try:
                    # Handle potential non-ms precision from old saves
                    dt_obj = datetime.fromisoformat(last_modified.replace('Z', '+00:00'))
                    last_modified = dt_obj.astimezone(timezone.utc).isoformat(timespec='milliseconds') + 'Z'
                except ValueError:
                    app.logger.warning(f"Invalid lastModified format for {key}: {last_modified}. Using raw value.")

            return {"value": data.get("value"), "lastModified": last_modified}
    except (json.JSONDecodeError, KeyError) as e:
        app.logger.error(f"Error loading user state for key '{key}' from '{path}': {e}")
        try:
            os.remove(path)
            app.logger.warning(f"Corrupt file '{path}' removed. It will be re-initialized on next request.")
        except OSError as oe:
            app.logger.error(f"Error removing corrupt file '{path}': {oe}")
        return {"value": None, "lastModified": None}
    except Exception as e:
        app.logger.exception(f"An unexpected error occurred loading user state for key '{key}' from '{path}': {e}")
        return {"value": None, "lastModified": None}

def _save_state(key, value):
    """Saves a single user state key with its value and updates its last modification timestamp."""
    now = datetime.now(timezone.utc).isoformat(timespec='milliseconds') + 'Z'
    data = {"value": value, "lastModified": now}
    path = _user_state_path(key)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        app.logger.info(f"Saved user state for key '{key}' to '{path}'. Timestamp: {now}")
        return now
    except Exception as e:
        app.logger.exception(f"Error saving user state for key '{key}' to '{path}': {e}")
        raise

@app.route("/api/user-state/<key>", methods=["GET"])
def get_single_user_state_key(key):
    """
    Returns the content of a single user state file.
    Supports If-None-Match header for caching using 'lastModified' timestamp.
    """
    if not key:
        app.logger.warning("GET /api/user-state/<key>: Key is missing")
        abort(400, description="User state key is required")

    state_data = _load_state(key)

    if state_data["value"] is None and state_data["lastModified"] is None:
        app.logger.info(f"GET /api/user-state/{key}: File could not be loaded or initialized, returning 404.")
        abort(404, description=f"User state key '{key}' not found or has no valid content after attempt to initialize.")

    if_none_match = request.headers.get("If-None-Match")
    if state_data["lastModified"] and if_none_match == state_data["lastModified"]:
        app.logger.info(f"GET /api/user-state/{key}: Returning 304 Not Modified. ETag: {state_data['lastModified']}")
        return make_response("", 304)

    resp_payload = {
        "value": state_data["value"],
        "lastModified": state_data["lastModified"]
    }

    resp = jsonify(resp_payload)
    if state_data["lastModified"]:
        resp.headers["ETag"] = state_data["lastModified"]
    resp.headers["Content-Type"] = "application/json"

    app.logger.info(f"GET /api/user-state/{key}: Returning 200 OK. ETag: {state_data.get('lastModified', 'None')}")
    app.logger.debug(f"GET /api/user-state/{key}: Payload: {resp_payload}")
    return resp, 200

@app.route("/api/user-state", methods=["POST"])
def post_user_state():
    """
    Receives and saves multiple user state key's changes.
    Expected payload is a list of operations:
    [
        {"type": "simpleUpdate", "key": "shuffleCount", "value": 5},
        {"type": "simpleUpdate", "key": "lastShuffleResetDate", "value": "2023-01-01T00:00:00.000Z"},
        {"type": "simpleUpdate", "key": "shuffledOutGuids", "value": ["guid1", "guid2"]},
        {"type": "starDelta", "data": {"id": "guid3", "action": "add", "starredAt": "..."}}
        {"type": "hiddenDelta", "data": {"id": "guid4", "action": "remove"}}
    ]
    """
    operations = request.get_json(silent=True)
    if not isinstance(operations, list):
        app.logger.warning("POST /api/user-state: Invalid or missing JSON body (expected a list of operations).")
        return jsonify({"error": "Invalid or missing JSON body (expected a list of operations)"}), 400

    results = []
    server_time = datetime.now(timezone.utc).isoformat(timespec='milliseconds') + 'Z' # Master timestamp for this sync batch

    for op in operations:
        op_type = op.get("type")

        try:
            if op_type == "simpleUpdate":
                key = op.get("key")
                value = op.get("value")

                if key not in USER_STATE_SERVER_DEFAULTS:
                    app.logger.warning(f"POST /api/user-state: Attempted to save unknown simpleUpdate key: {key}. Skipping.")
                    results.append({"opType": op_type, "key": key, "status": "skipped", "reason": "Unknown key"})
                    continue

                if key == 'shuffleCount':
                    # Load current count, apply max logic
                    current_count_data = _load_state('shuffleCount')
                    current_count = current_count_data['value'] if isinstance(current_count_data['value'], int) else 0

                    if value == 0: # Client explicitly resetting
                        new_count = 0
                        app.logger.info("shuffleCount reset to 0 by client request.")
                    else:
                        new_count = max(current_count, value)
                        app.logger.info(f"shuffleCount updated from {current_count} to {new_count} (max logic).")
                    _save_state(key, new_count)
                    results.append({"opType": op_type, "key": key, "status": "success", "serverTime": server_time, "value": new_count})
                # --- START FIX: Handle starred/hidden arrays when sent as simpleUpdate ---
                elif key in ['starred', 'hidden']:
                    # This branch handles the case where client's saveArrayState sends a 'simpleUpdate'
                    # with just a list of GUIDs for 'starred' or 'hidden'.
                    # We need to convert this list of GUIDs into the expected object format {guid, timestamp}.
                    # For simplicity, we assign the current server_time as the timestamp for all items
                    # in this full list update. More complex merging strategies are possible but not implemented here.
                    if not isinstance(value, list):
                        app.logger.warning(f"POST /api/user-state: Expected list of GUIDs for {key} simpleUpdate, got {type(value)}. Skipping.")
                        results.append({"opType": op_type, "key": key, "status": "skipped", "reason": "Expected list of GUIDs"})
                        continue

                    timestamp_field = 'starredAt' if key == 'starred' else 'hiddenAt'
                    new_full_list_of_objects = [{"guid": guid, timestamp_field: server_time} for guid in value]

                    _save_state(key, new_full_list_of_objects)
                    app.logger.info(f"POST /api/user-state: Saved full array update for key '{key}'. Number of items: {len(new_full_list_of_objects)}")
                    results.append({"opType": op_type, "key": key, "status": "success", "serverTime": server_time, "value_count": len(new_full_list_of_objects)})
                # --- END FIX ---
                else:
                    # For other simple updates (lastShuffleResetDate, filterMode, etc.,
                    # including currentDeckGuids, shuffledOutGuids, rssFeeds, keywordBlacklist)
                    _save_state(key, value)
                    app.logger.info(f"POST /api/user-state: Saved simple update for key '{key}'.")
                    results.append({"opType": op_type, "key": key, "status": "success", "serverTime": server_time})

            elif op_type == "starDelta":
                # The client sends 'id', which is the GUID. Rename for clarity in backend.
                item_guid = op["data"].get("id")
                action = op["data"].get("action")

                if not item_guid:
                    raise ValueError("Missing 'id' (GUID) for starDelta operation.")

                current_state_data = _load_state("starred")
                current_starred = current_state_data['value'] or []

                if action == "add":
                    # Store as {'guid': '...', 'starredAt': '...'}
                    # Ensure it's not already there before adding
                    if not any(s["guid"] == item_guid for s in current_starred):
                        entry = {"guid": item_guid, "starredAt": server_time}
                        current_starred.append(entry)
                        app.logger.info(f"starDelta: Added GUID {item_guid}")
                    else:
                        app.logger.info(f"starDelta: GUID {item_guid} already exists, not adding.")
                elif action == "remove":
                    original_len = len(current_starred)
                    current_starred = [s for s in current_starred if s["guid"] != item_guid] # Filter by 'guid'
                    if len(current_starred) < original_len:
                        app.logger.info(f"starDelta: Removed GUID {item_guid}")
                    else:
                        app.logger.info(f"starDelta: GUID {item_guid} not found for removal.")
                else:
                    raise ValueError(f"Invalid starDelta action: {action}")

                _save_state("starred", current_starred)
                results.append({"opType": op_type, "id": item_guid, "action": action, "status": "success", "serverTime": server_time})

            elif op_type == "hiddenDelta":
                # The client sends 'id', which is the GUID. Rename for clarity in backend.
                item_guid = op["data"].get("id")
                action = op["data"].get("action")

                if not item_guid:
                    raise ValueError("Missing 'id' (GUID) for hiddenDelta operation.")

                current_state_data = _load_state("hidden")
                current_hidden = current_state_data['value'] or []

                if action == "add":
                    # Store as {'guid': '...', 'hiddenAt': '...'}
                    # Ensure it's not already there before adding
                    if not any(h["guid"] == item_guid for h in current_hidden):
                        entry = {"guid": item_guid, "hiddenAt": server_time}
                        current_hidden.append(entry)
                        app.logger.info(f"hiddenDelta: Added GUID {item_guid}")
                    else:
                        app.logger.info(f"hiddenDelta: GUID {item_guid} already exists, not adding.")
                elif action == "remove":
                    original_len = len(current_hidden)
                    current_hidden = [h for h in current_hidden if h["guid"] != item_guid] # Filter by 'guid'
                    if len(current_hidden) < original_len:
                        app.logger.info(f"hiddenDelta: Removed GUID {item_guid}")
                    else:
                        app.logger.info(f"hiddenDelta: GUID {item_guid} not found for removal.")
                else:
                    raise ValueError(f"Invalid hiddenDelta action: {action}")

                _save_state("hidden", current_hidden)
                results.append({"opType": op_type, "id": item_guid, "action": action, "status": "success", "server_time": server_time})

            else:
                app.logger.warning(f"POST /api/user-state: Unknown operation type: {op_type}. Skipping.")
                results.append({"opType": op_type, "status": "skipped", "reason": "Unknown operation type"})

        except Exception as e:
            app.logger.exception(f"Error processing operation {op_type} for data {op.get('data', op.get('key'))}: {e}")
            results.append({"opType": op_type, "status": "failed", "reason": str(e)})

    app.logger.info(f"POST /api/user-state: Processed {len(operations)} operations. Results: {results}")
    return jsonify({"status": "ok", "serverTime": server_time, "results": results}), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=4575, debug=True)