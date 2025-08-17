# @filepath: src/api.py

from flask import Flask, request, jsonify, abort, make_response
from datetime import datetime, timezone
from xml.etree import ElementTree as ET
from email.utils import parsedate_to_datetime
from werkzeug.middleware.proxy_fix import ProxyFix
import os
import json
import secrets
import logging, html

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
app.logger.setLevel(logging.DEBUG) # Keep DEBUG for development, INFO for production

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
    'shuffleCount': {'type': 'simple', 'default': 2},
    'openUrlsInNewTabEnabled': {'type': 'simple', 'default': True},
    'starred': {'type': 'array', 'default': []}, # Array of { guid, starredAt }
    'hidden': {'type': 'array', 'default': []},   # Array of { guid, hiddenAt }
    'filterMode': {'type': 'simple', 'default': 'unread'},
    'syncEnabled': {'type': 'simple', 'default': True},
    'imagesEnabled': {'type': 'simple', 'default': True},
    'lastStateSync': {'type': 'simple', 'default': None},
    'lastViewedItemId': {'type': 'simple', 'default': None},
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
        root = ET.fromstring(feed_content)
        app.logger.debug("Successfully parsed feed.xml")
    except (FileNotFoundError, ET.ParseError) as e:
        app.logger.warning(f"Failed to load or parse feed.xml: {e}")
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
            description_content = "".join(
                ET.tostring(child, encoding='unicode') for child in description_element
            )
            if description_element.text:
                description_content = description_element.text.strip() + description_content
        
        unescaped_description = html.unescape(description_content)

        data = {
            "guid": guid,
            "title": it.findtext("title"),
            "link": it.findtext("link"),
            "pubDate": pub_iso,
            "description": unescaped_description,
        }
        items[guid] = data
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
            latest_pub_date = max(
                datetime.fromisoformat(item['pubDate'].replace('Z', '+00:00'))
                for item in items.values() if item.get('pubDate')
            )
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

def _user_state_path(key):
    return os.path.join(USER_STATE_DIR, f"{key}.json")

def _load_state(key):
    path = _user_state_path(key)
    if not os.path.exists(path):
        default_data = USER_STATE_SERVER_DEFAULTS.get(key)
        if default_data:
            initial_value = default_data['default']
            now_utc = datetime.now(timezone.utc).isoformat(timespec='milliseconds') + 'Z'
            initial_state = {"value": initial_value, "lastModified": now_utc}
            try:
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(initial_state, f, indent=2)
                return initial_state
            except Exception:
                return {"value": None, "lastModified": None}
        return {"value": None, "lastModified": None}

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {"value": data.get("value"), "lastModified": data.get("lastModified")}
    except (json.JSONDecodeError, KeyError):
        return {"value": None, "lastModified": None}

def _save_state(key, value):
    now = datetime.now(timezone.utc).isoformat(timespec='milliseconds') + 'Z'
    data = {"value": value, "lastModified": now}
    path = _user_state_path(key)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        return now
    except Exception as e:
        app.logger.exception(f"Error saving user state for key '{key}': {e}")
        raise

@app.route("/api/user-state/<key>", methods=["GET"])
def get_single_user_state_key(key):
    if not key:
        abort(400, description="User state key is required")
    state_data = _load_state(key)
    if state_data["value"] is None and state_data["lastModified"] is None:
        abort(404, description=f"User state key '{key}' not found.")

    if_none_match = request.headers.get("If-None-Match")
    if state_data["lastModified"] and if_none_match == state_data["lastModified"]:
        return make_response("", 304)

    resp = jsonify(state_data)
    if state_data["lastModified"]:
        resp.headers["ETag"] = state_data["lastModified"]
    return resp, 200

@app.route("/api/user-state", methods=["POST"])
def post_user_state():
    operations = request.get_json(silent=True)
    if not isinstance(operations, list):
        return jsonify({"error": "Invalid JSON body, expected a list of operations"}), 400

    results = []
    server_time = datetime.now(timezone.utc).isoformat(timespec='milliseconds') + 'Z'

    for op in operations:
        op_type = op.get("type")
        op_id = op.get("id")
        key = op.get("key")
        try:
            if op_type == "simpleUpdate":
                if key not in USER_STATE_SERVER_DEFAULTS:
                    results.append({"id": op_id, "status": "skipped", "reason": "Unknown key"})
                    continue
                _save_state(key, op.get("value"))
                results.append({"id": op_id, "key": key, "status": "success", "serverTime": server_time})

            elif op_type in ["starDelta", "hiddenDelta"]:
                data = op.get("data", {})
                item_guid = data.get("itemGuid")
                action = data.get("action")
                state_key = "starred" if op_type == "starDelta" else "hidden"
                timestamp_key = "starredAt" if op_type == "starDelta" else "hiddenAt"

                if not item_guid or action not in ["add", "remove"]:
                    raise ValueError("Missing 'itemGuid' or invalid 'action'")

                current_state_data = _load_state(state_key)
                current_list = current_state_data['value'] or []

                if action == "add":
                    if not any(item["guid"] == item_guid for item in current_list):
                        current_list.append({"guid": item_guid, timestamp_key: server_time})
                elif action == "remove":
                    current_list = [item for item in current_list if item.get("guid") != item_guid]

                _save_state(state_key, current_list)
                results.append({"id": op_id, "status": "success", "serverTime": server_time})

            else:
                results.append({"id": op_id, "status": "skipped", "reason": "Unknown operation type"})
        except Exception as e:
            app.logger.exception(f"Error processing operation {op_type} for key {key}: {e}")
            results.append({"id": op_id, "status": "failed", "reason": str(e)})

    return jsonify({"status": "ok", "serverTime": server_time, "results": results}), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=4575, debug=True)