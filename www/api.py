# www/api.py
from flask import Flask, request, jsonify, abort, make_response
from datetime import datetime, timezone
from xml.etree import ElementTree as ET
from email.utils import parsedate_to_datetime
from werkzeug.middleware.proxy_fix import ProxyFix
import os
import json
import secrets
import logging

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
app.logger.setLevel(logging.INFO)

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
    'currentDeckGuids': {'type': 'array', 'default': []},
    'lastShuffleResetDate': {'type': 'simple', 'default': None},
    'shuffleCount': {'type': 'simple', 'default': 0},
    'openUrlsInNewTabEnabled': {'type': 'simple', 'default': True},
    'starred': {'type': 'array', 'default': []},
    'hidden': {'type': 'array', 'default': []},
    'filterMode': {'type': 'simple', 'default': 'all'},
    'syncEnabled': {'type': 'simple', 'default': True},
    'imagesEnabled': {'type': 'simple', 'default': True},
    'lastStateSync': {'type': 'simple', 'default': None},
    'lastViewedItemId': {'type': 'simple', 'default': None},
    'lastViewedItemOffset': {'type': 'simple', 'default': 0},
    # --- ADDED/UPDATED ---
    'theme': {'type': 'simple', 'default': 'light'}, # Added default for theme
    'lastFeedSync': {'type': 'simple', 'default': None}, # Added default for lastFeedSync
    'feedScrollY': {'type': 'simple', 'default': 0}, # Added default for feedScrollY
    'feedVisibleLink': {'type': 'simple', 'default': ''}, # Added default for feedVisibleLink
    # --- /ADDED/UPDATED ---
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
        resp.set_cookie("auth", auth_token, max_age=90*24*60*60, http_only=True, secure=True, samesite="Strict", path="/")
        app.logger.info("Login: Successful authentication")
        return resp
    except Exception as e:
        app.logger.exception(f"Login error: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500

def _load_feed_items():
    """Loads RSS feed items from feed.xml and returns them as a dictionary."""
    try:
        tree = ET.parse(FEED_XML)
    except (FileNotFoundError, ET.ParseError) as e:
        app.logger.warning(f"Failed to load or parse feed.xml: {e}")
        return {}

    root = tree.getroot()
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
            pub_iso = dt.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        except Exception:
            pub_iso = raw_date

        data = {
            "guid": guid,
            "title": it.findtext("title"),
            "link": it.findtext("link"),
            "pubDate": pub_iso,
            "desc": it.findtext("description")
        }
        items[guid] = data
    return items

@app.route("/load-config", methods=["GET", "POST"])
def load_config():
    filename = request.args.get("filename")
    if not filename:
        abort(400, description="filename query parameter is required")
    
    filepath = os.path.join(CONFIG_DIR, filename)
    if not os.path.exists(filepath):
        app.logger.info(f"Config file not found: {filepath}")
        abort(404, description="Config file not found")
    
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
        app.logger.info(f"Loaded config file: {filename}")
        return jsonify({"content": content}), 200
    except Exception as e:
        app.logger.exception(f"Error loading config file {filename}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/save-config", methods=["POST"])
def save_config():
    filename = request.args.get("filename")
    if not filename:
        abort(400, description="filename query parameter is required")
    
    data = request.get_json(silent=True)
    content = data.get("content", "") if data else ""
    
    filepath = os.path.join(CONFIG_DIR, filename)
    try:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        app.logger.info(f"Saved config file: {filename}")
        return jsonify({"status": "ok"}), 200
    except Exception as e:
        app.logger.exception(f"Error saving config file {filename}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/time", methods=["GET"])
def time():
    """Returns the current UTC time in ISO format."""
    now = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    app.logger.debug(f"Time requested: {now}")
    return jsonify({"time": now}), 200

# --- UPDATED: Feed GUIDs Endpoint with serverTime ---
@app.route("/feed-guids", methods=["GET"])
def feed_guids():
    """Returns a list of all item GUIDs from the feed and the server's current time."""
    items = _load_feed_items()
    now = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    app.logger.info(f"Returning {len(items)} GUIDs with server time.")
    return jsonify({"guids": list(items.keys()), "serverTime": now}), 200

# --- RENAMED & UPDATED: Feed Items Endpoint ---
@app.route("/feed-items", methods=["GET", "POST"])
def feed_items():
    """
    Returns full item data for specified GUIDs.
    GET: guids comma-separated in query param.
    POST: JSON body with {"guids": ["guid1", "guid2"]}.
    """
    wanted = []
    if request.method == "GET":
        guids_param = request.args.get("guids", "")
        wanted = guids_param.split(",") if guids_param else []
    elif request.method == "POST":
        data = request.get_json(silent=True)
        wanted = data.get("guids", []) if data else []
    
    all_items = _load_feed_items()
    result = {g: all_items[g] for g in wanted if g in all_items}
    app.logger.info(f"Returning {len(result)} items for {len(wanted)} requested GUIDs.")
    return jsonify(list(result.values())), 200 # Return list of item objects, not dict of items

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

@app.route("/user-state/<key>", methods=["GET"])
def get_single_user_state_key(key):
    """
    Returns the content of a single user state file.
    Supports If-None-Match header for caching using 'lastModified' timestamp.
    """
    if not key:
        app.logger.warning("GET /user-state/<key>: Key is missing")
        abort(400, description="User state key is required")

    state_data = _load_state(key)
    
    if state_data["value"] is None and state_data["lastModified"] is None:
        app.logger.info(f"GET /user-state/{key}: File could not be loaded or initialized, returning 404.")
        abort(404, description=f"User state key '{key}' not found or has no valid content after attempt to initialize.")

    if_none_match = request.headers.get("If-None-Match")
    if state_data["lastModified"] and if_none_match == state_data["lastModified"]:
        app.logger.info(f"GET /user-state/{key}: Returning 304 Not Modified. ETag: {state_data['lastModified']}")
        return make_response("", 304)

    resp_payload = {
        "value": state_data["value"], 
        "lastModified": state_data["lastModified"]
    }
    
    resp = jsonify(resp_payload)
    if state_data["lastModified"]:
        resp.headers["ETag"] = state_data["lastModified"]
    resp.headers["Content-Type"] = "application/json"
    
    app.logger.info(f"GET /user-state/{key}: Returning 200 OK. ETag: {state_data.get('lastModified', 'None')}")
    app.logger.debug(f"GET /user-state/{key}: Payload: {resp_payload}")
    return resp, 200

@app.route("/user-state", methods=["POST"])
def post_user_state():
    """
    Receives and saves a single user state key's change.
    Expected payload: {"key": "someKey", "value": "someValue"}
    """
    data = request.get_json(silent=True)
    if not data or "key" not in data or "value" not in data:
        app.logger.warning("POST /user-state: Invalid or missing 'key' or 'value' in JSON body")
        return jsonify({"error": "Invalid or missing 'key' or 'value' in JSON body"}), 400

    key = data["key"]
    value = data["value"]
    
    try:
        server_time = _save_state(key, value)
        app.logger.info(f"POST /user-state: Successfully saved key '{key}'")
        return jsonify({"serverTime": server_time, "status": "ok"}), 200
    except Exception as e:
        app.logger.exception(f"POST /user-state: Error saving user state key '{key}' with value '{value}': {e}")
        return jsonify({"error": f"Failed to save state for {key}", "details": str(e)}), 500

@app.route("/user-state/hidden/delta", methods=["POST"])
def hidden_delta():
    """Adds or removes an item from the hidden list."""
    data = request.get_json(silent=True)
    if not data:
        app.logger.warning("POST /user-state/hidden/delta: Missing JSON body")
        abort(400, description="Missing JSON body")

    state_content = _load_state("hidden") 
    state = state_content["value"] or []

    action = data.get("action")
    id_ = data.get("id")
    
    if not id_ or not action:
        app.logger.warning(f"POST /user-state/hidden/delta: Missing ID or action. Data: {data}")
        abort(400, description="ID and action are required")

    if action == "add":
        entry = {"id": id_, "hiddenAt": data.get("hiddenAt") or datetime.now(timezone.utc).isoformat(timespec='milliseconds') + 'Z'}
        if not any(h["id"] == id_ for h in state):
            state.append(entry)
            app.logger.info(f"hidden_delta: Added ID {id_}")
        else:
            app.logger.info(f"hidden_delta: ID {id_} already exists, not adding.")
    elif action == "remove":
        original_len = len(state)
        state = [h for h in state if h["id"] != id_]
        if len(state) < original_len:
            app.logger.info(f"hidden_delta: Removed ID {id_}")
        else:
            app.logger.info(f"hidden_delta: ID {id_} not found for removal.")
    else:
        app.logger.warning(f"POST /user-state/hidden/delta: Invalid action '{action}'")
        abort(400, description="Invalid action")
    
    try:
        server_time = _save_state("hidden", state)
        return jsonify({"serverTime": server_time}), 200
    except Exception as e:
        app.logger.exception(f"Error in hidden_delta for ID {id_}, action {action}: {e}")
        return jsonify({"error": f"Failed to save hidden state", "details": str(e)}), 500

@app.route("/user-state/starred/delta", methods=["POST"])
def starred_delta():
    """Adds or removes an item from the starred list."""
    data = request.get_json(silent=True)
    if not data:
        app.logger.warning("POST /user-state/starred/delta: Missing JSON body")
        abort(400, description="Missing JSON body")

    state_content = _load_state("starred") 
    state = state_content["value"] or []

    action = data.get("action")
    id_ = data.get("id")

    if not id_ or not action:
        app.logger.warning(f"POST /user-state/starred/delta: Missing ID or action. Data: {data}")
        abort(400, description="ID and action are required")

    if action == "add":
        entry = {"id": id_, "starredAt": data.get("starredAt") or datetime.now(timezone.utc).isoformat(timespec='milliseconds') + 'Z'}
        if not any(s["id"] == id_ for s in state):
            state.append(entry)
            app.logger.info(f"starred_delta: Added ID {id_}")
        else:
            app.logger.info(f"starred_delta: ID {id_} already exists, not adding.")
    elif action == "remove":
        original_len = len(state)
        state = [s for s in state if s["id"] != id_]
        if len(state) < original_len:
            app.logger.info(f"starred_delta: Removed ID {id_}")
        else:
            app.logger.info(f"starred_delta: ID {id_} not found for removal.")
    else:
        app.logger.warning(f"POST /user-state/starred/delta: Invalid action '{action}'")
        abort(400, description="Invalid action")
    
    try:
        server_time = _save_state("starred", state)
        return jsonify({"serverTime": server_time}), 200
    except Exception as e:
        app.logger.exception(f"Error in starred_delta for ID {id_}, action {action}: {e}")
        return jsonify({"error": f"Failed to save starred state", "details": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=4575, debug=True)