# api.py
from flask import Flask, request, jsonify, abort, make_response
from datetime import datetime, timezone
from xml.etree import ElementTree as ET
from email.utils import parsedate_to_datetime
from werkzeug.middleware.proxy_fix import ProxyFix
import os
import json
import secrets
import sys # Keep this import

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

DATA_DIR = "/data"
FEED_DIR = os.path.join(DATA_DIR, "feed")
CONFIG_DIR = os.path.join(DATA_DIR, "config")
USER_STATE_DIR = os.path.join(DATA_DIR, "user_state")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(FEED_DIR, exist_ok=True)
os.makedirs(CONFIG_DIR, exist_ok=True)
os.makedirs(USER_STATE_DIR, exist_ok=True)

FEED_XML = os.path.join(FEED_DIR, "feed.xml")

@app.route("/api/login", methods=["POST"])
def login():
    try:
        if not request.is_json: return jsonify({"error": "Missing JSON in request"}), 400
        data = request.get_json()
        submitted_pw = data.get("password")
        if not submitted_pw: return jsonify({"error": "Password required"}), 400
        if "APP_PASSWORD" not in os.environ: return jsonify({"error": "Server misconfigured"}), 500
        if submitted_pw != os.environ["APP_PASSWORD"]: return jsonify({"error": "Invalid password"}), 401
        auth_token = secrets.token_urlsafe(32)
        resp = make_response(jsonify({"status": "ok"}))
        resp.set_cookie("auth", auth_token, max_age=90*24*60*60, httpy_only=True, secure=True, samesite="Strict", path="/")
        return resp
    except Exception as e:
        app.logger.error(f"Login error: {str(e)}")
        app.logger.error(f"Request data: {request.get_data()}")
        return jsonify({"error": "Internal server error"}), 500

def _load_feed_items():
    try: tree = ET.parse(FEED_XML)
    except (FileNotFoundError, ET.ParseError): return {}
    for elem in tree.getroot().iter():
        if "}" in elem.tag: elem.tag = elem.tag.split("}", 1)[1]
    root = tree.getroot()
    items = {}
    for it in root.findall(".//item"):
        guid = it.findtext("guid") or it.findtext("link")
        raw_date = it.findtext("pubDate") or ""
        try: dt = parsedate_to_datetime(raw_date); pub_iso = dt.astimezone(timezone.utc).isoformat()
        except Exception: pub_iso = raw_date
        data = {"guid": guid, "title": it.findtext("title"), "link": it.findtext("link"), "pubDate": pub_iso, "desc": it.findtext("description")}
        items[guid] = data
    return items

@app.route("/load-config", methods=["GET", "POST"])
def load_config():
    filename = request.args.get("filename")
    if not filename: abort(400, description="filename query parameter is required")
    filepath = os.path.join(CONFIG_DIR, filename)
    if not os.path.exists(filepath): abort(404, description="Config file not found")
    try:
        with open(filepath, "r", encoding="utf-8") as f: content = f.read()
        return jsonify({"content": content}), 200
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route("/save-config", methods=["POST"])
def save_config():
    filename = request.args.get("filename")
    if not filename: abort(400, description="filename query parameter is required")
    data = request.get_json(force=True)
    content = data.get("content", "")
    filepath = os.path.join(CONFIG_DIR, filename)
    try:
        with open(filepath, "w", encoding="utf-8") as f: f.write(content)
        return jsonify({"status": "ok"}), 200
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route("/time", methods=["GET"])
def time():
    now = datetime.now(timezone.utc).isoformat()
    return jsonify({"time": now}), 200

@app.route("/guids", methods=["GET"])
def guids():
    items = _load_feed_items()
    return jsonify(list(items.keys())), 200

@app.route("/items", methods=["GET", "POST"])
def items():
    guids = request.args.get("guids", "")
    wanted = guids.split(",") if guids else []
    if request.method == "POST":
        data = request.get_json(force=True)
        wanted = data.get("guids", [])
    all_items = _load_feed_items()
    result = {g: all_items[g] for g in wanted if g in all_items}
    return jsonify(result), 200

def _user_state_path(key): return os.path.join(USER_STATE_DIR, f"{key}.json")

def _load_state(key):
    """Loads a single user state key, returning its value and last modification timestamp."""
    path = _user_state_path(key)
    if not os.path.exists(path):
        app.logger.info(f"User state file not found for key {key} at {path}. Returning default.")
        return {"value": None, "lastModified": None}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            # Ensure 'value' exists and default to None if not
            return {"value": data.get("value"), "lastModified": data.get("lastModified")}
    except (json.JSONDecodeError, KeyError) as e:
        app.logger.error(f"Error loading user state for key {key} from {path}: {e}")
        return {"value": None, "lastModified": None} # Return default on error

def _save_state(key, value):
    """Saves a single user state key with its value and updates its last modification timestamp."""
    now = datetime.now(timezone.utc).isoformat()
    data = {"value": value, "lastModified": now}
    try:
        with open(_user_state_path(key), "w", encoding="utf-8") as f:
            json.dump(data, f)
        return now
    except Exception as e:
        app.logger.error(f"Error saving user state for key {key}: {e}")
        raise # Re-raise to indicate failure

@app.route("/user-state", methods=["GET"])
def get_user_state():
    """
    Returns the full user state.
    Supports If-None-Match header for caching.
    The client-side `pullUserState` expects `userState` object and `serverTime`.
    """
    # Removed 'since' as it's not used for full state
    
    # Define all keys that make up the client's userState
    user_state_keys = [
        "hidden",
        "starred",
        "currentDeckGuids",
        "filterMode",
        "syncEnabled",
        "imagesEnabled",
        "rssFeeds",
        "keywordBlacklist",
        "shuffleCount",
        "lastShuffleResetDate",
        "openUrlsInNewTabEnabled"
    ]

    # Collect current state and find the newest modification timestamp
    out_user_state = {}
    newest_timestamp = None

    for key in user_state_keys:
        state_data = _load_state(key)
        
        # Only include if value is not None, indicating it exists or has a default
        if state_data["value"] is not None:
            out_user_state[key] = state_data["value"]
            if state_data["lastModified"]:
                if not newest_timestamp or state_data["lastModified"] > newest_timestamp:
                    newest_timestamp = state_data["lastModified"]
        else:
            # Provide default empty values for common list-based states if not found
            if key in ["hidden", "starred", "currentDeckGuids"]:
                out_user_state[key] = []
            elif key in ["filterMode", "rssFeeds", "keywordBlacklist"]:
                out_user_state[key] = ""
            elif key in ["syncEnabled", "imagesEnabled", "openUrlsInNewTabEnabled"]: 
                out_user_state[key] = True
            elif key == "shuffleCount":
                out_user_state[key] = 2
            elif key == "lastShuffleResetDate":
                out_user_state[key] = None

    # ETag logic for caching
    etag = newest_timestamp if newest_timestamp else ""
    if_none_match = request.headers.get("If-None-Match")

    # Log what's being returned for 304 (Not Modified)
    if if_none_match == etag:
        app.logger.info(f"API: Returning 304 Not Modified for /user-state. ETag: {etag}")
        return make_response("", 304)

    resp_payload = {"userState": out_user_state, "serverTime": etag}
    
    # --- ADDED DEBUGGING LOGS HERE ---
    try:
        json_str_to_send = json.dumps(resp_payload, indent=2) # indent for readability in logs
        app.logger.info(f"API: Preparing 200 OK /user-state response. Payload size: {len(json_str_to_send)} bytes.")
        app.logger.info(f"API: Payload START (first 200 chars): {json_str_to_send[:200]}")
        app.logger.info(f"API: Payload END (last 200 chars): {json_str_to_send[-200:]}")
        app.logger.info(f"API: FULL Payload (first 1000 chars): {json_str_to_send[:1000]}") # Log full payload snippet
    except Exception as e:
        app.logger.error(f"API ERROR: Could not log /user-state payload for inspection: {e}")
        # Log the dictionary content if dumping failed
        app.logger.error(f"API ERROR: Problematic resp_payload dictionary: {resp_payload}")


    resp = jsonify(resp_payload)
    resp.headers["ETag"] = etag
    resp.headers["Content-Type"] = "application/json" # Explicitly ensure Content-Type is set

    return resp, 200

@app.route("/user-state", methods=["POST"])
def post_user_state():
    """
    Receives and saves user state changes.
    The client-side `pushUserState` sends `userState` object.
    """
    data = request.get_json(silent=True)
    # Expecting {"userState": {"key1": value1, "key2": value2, ...}}
    if not data or "userState" not in data or not isinstance(data["userState"], dict):
        return jsonify({"error": "Invalid or missing 'userState' dictionary in JSON body"}), 400

    server_time = None
    app.logger.info(f"post_user_state: Received data: {data}")
    # Iterate over the provided user state map
    for key, val in data["userState"].items():
        try:
            server_time = _save_state(key, val)
        except Exception as e:
            app.logger.error(f"Error saving user state key '{key}' with value '{val}': {e}")
            return jsonify({"error": f"Failed to save state for {key}", "details": str(e)}), 500

    return jsonify({"serverTime": server_time}), 200

@app.route("/user-state/hidden/delta", methods=["POST"])
def hidden_delta():
    data = request.get_json(force=True)
    state = _load_state("hidden")["value"] or []
    action = data.get("action")
    id_ = data.get("id")
    
    if action == "add":
        entry = {"id": id_, "hiddenAt": data.get("hiddenAt")}
        if not any(h["id"] == id_ for h in state):
            state.append(entry)
    elif action == "remove":
        state = [h for h in state if h["id"] != id_]
    else:
        abort(400, description="Invalid action")
    
    server_time = _save_state("hidden", state)
    return jsonify({"serverTime": server_time}), 200

@app.route("/user-state/starred/delta", methods=["POST"])
def starred_delta():
    data = request.get_json(force=True)
    state = _load_state("starred")["value"] or []
    action = data.get("action")
    id_ = data.get("id")

    if action == "add":
        entry = {"id": id_, "starredAt": data.get("starredAt")}
        if not any(s["id"] == id_ for s in state):
            state.append(entry)
    elif action == "remove":
        state = [s for s in state if s["id"] != id_]
    else:
        abort(400, description="Invalid action")
    
    server_time = _save_state("starred", state)
    return jsonify({"serverTime": server_time}), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=4575)