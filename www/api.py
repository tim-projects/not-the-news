from flask import Flask, request, jsonify, abort, make_response
from datetime import datetime, timezone
from xml.etree import ElementTree as ET
from email.utils import parsedate_to_datetime
from werkzeug.middleware.proxy_fix import ProxyFix
import os
import json, secrets

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
        resp.set_cookie("auth", auth_token, max_age=90*24*60*60, httponly=True, secure=True, samesite="Strict", path="/")
        return resp
    except Exception as e:
        app.logger.error(f"Login error: {str(e)}")
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
    path = _user_state_path(key)
    if not os.path.exists(path): return {"value": None, "lastModified": None}
    with open(path, "r", encoding="utf-8") as f: return json.load(f)

def _save_state(key, value):
    now = datetime.now(timezone.utc).isoformat()
    data = {"value": value, "lastModified": now}
    with open(_user_state_path(key), "w", encoding="utf-8") as f: json.dump(data, f)
    return now

@app.route("/user-state", methods=["GET"])
def get_user_state():
    since = request.args.get("since")
    out = {}
    newest = since
    for key in ("hidden", "starred", "settings"):
        st = _load_state(key)
        lm = st.get("lastModified")
        if lm and (not since or lm > since):
            out[key] = st["value"]
            if not newest or lm > newest: newest = lm
    if_none = request.headers.get("If-None-Match")
    etag = newest or ""
    if if_none == etag: return ("", 304)
    resp = jsonify({"changes": out, "serverTime": newest})
    resp.headers["ETag"] = etag
    return resp, 200

@app.route("/user-state", methods=["POST"])
def post_user_state():
    data = request.get_json(silent=True)
    if not data or "changes" not in data or not isinstance(data["changes"], dict): return jsonify({"error": "Invalid or missing JSON body"}), 400
    server_time = None
    for key, val in data["changes"].items():
        current = _load_state(key)["value"] or ({} if key == "settings" else [])
        if isinstance(current, list) and isinstance(val, list): merged = val
        else: merged = val
        server_time = _save_state(key, merged)
    return jsonify({"serverTime": server_time}), 200

@app.route("/user-state/hidden/delta", methods=["POST"])
def hidden_delta():
    data = request.get_json(force=True)
    state = _load_state("hidden")["value"] or []
    action = data.get("action")
    id_ = data.get("id")
    if action == "add":
        entry = {"id": id_, "hiddenAt": data.get("hiddenAt")}
        if all(h["id"] != id_ for h in state): state.append(entry)
    elif action == "remove": state = [h for h in state if h["id"] != id_]
    else: abort(400, description="Invalid action")
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
        if all(s["id"] != id_ for s in state): state.append(entry)
    elif action == "remove": state = [s for s in state if s["id"] != id_]
    else: abort(400, description="Invalid action")
    server_time = _save_state("starred", state)
    return jsonify({"serverTime": server_time}), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000)