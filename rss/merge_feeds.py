import time
from urllib.parse import urlparse
import feedparser
import threading
from feedgen.feed import FeedGenerator
from datetime import datetime, timezone
from dateutil.parser import parse
import argparse
import requests
import pprint
import hashlib
import redis
import re
import os
import json
import logging

# Define paths (adjust if necessary based on where these scripts are run from)
DATA_DIR = "/data"
USER_STATE_DIR = os.path.join(DATA_DIR, "user_state")
RSS_FEEDS_JSON = os.path.join(USER_STATE_DIR, "rssFeeds.json")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def load_rss_feeds():
    if not os.path.exists(RSS_FEEDS_JSON):
        logging.warning(f"RSS feeds JSON file not found: {RSS_FEEDS_JSON}")
        return []
    try:
        with open(RSS_FEEDS_JSON, 'r', encoding='utf-8') as f:
            data = json.load(f)
            nested_feeds_data = data.get('value', {}) # Expect a dictionary for nested structure
            
            all_urls = []
            if isinstance(nested_feeds_data, dict):
                for category, subcategories in nested_feeds_data.items():
                    if isinstance(subcategories, dict):
                        for subcategory, feeds_list in subcategories.items():
                            if isinstance(feeds_list, list):
                                for feed_item in feeds_list:
                                    if isinstance(feed_item, dict) and 'url' in feed_item:
                                        url = feed_item['url']
                                        if isinstance(url, str) and is_valid_url(url):
                                            all_urls.append(url)
                                        else:
                                            logging.warning(f"Invalid or malformed RSS feed URL skipped: {url} (from item: {feed_item})")
                                    else:
                                        logging.warning(f"Invalid or malformed RSS feed item skipped: {feed_item}")
                            else:
                                logging.warning(f"Expected list of feeds for subcategory '{subcategory}', but got: {feeds_list}")
                    else:
                        logging.warning(f"Expected dictionary of subcategories for category '{category}', but got: {subcategories}")
            else:
                logging.warning(f"Expected dictionary for nested feeds data, but got: {nested_feeds_data}")

            return all_urls
    except json.JSONDecodeError as e:
        logging.error(f"Error decoding RSS feeds JSON: {e}")
        return []
    except Exception as e:
        logging.error(f"Error loading RSS feeds: {e}")
        return []

def is_valid_url(url):
    try:
        result = urlparse(url)
        return all([result.scheme, result.netloc])
    except ValueError:
        return False

# ─── Redis client for caching raw feed bytes ─────────────────────────────────
r = redis.Redis(host="localhost", port=6379, db=0)

# ─── Global backoff & rate-limit settings ─────────────────────────────────────

# ─── Token-bucket rate limiter for QPM limits ─────────────────────────────────
USE_OAUTH = False  # True if you’ve authenticated via OAuth
API_QPM = 100 if USE_OAUTH else 10
FRONTEND_QPM = 60
RATE_LIMIT_QPM = min(API_QPM, FRONTEND_QPM)
BUCKET_CAPACITY = 18  # max burst capacity
REFILL_RATE = RATE_LIMIT_QPM / 60  # tokens per second

# token-bucket state
_tokens = BUCKET_CAPACITY
_last_refill = time.monotonic()
_bucket_lock = threading.Lock()


def _consume_token():
    """Block until a token is available from the bucket, then consume one."""
    global _tokens, _last_refill
    while True:
        now = time.monotonic()
        elapsed = now - _last_refill
        with _bucket_lock:
            # refill
            _tokens = min(BUCKET_CAPACITY, _tokens + elapsed * REFILL_RATE)
            _last_refill = now
            if _tokens >= 1:
                _tokens -= 1
                return
            # else: not enough tokens, will sleep outside lock
        # compute how long until at least one token
        to_wait = (1 - _tokens) / REFILL_RATE
        time.sleep(to_wait)


# Exponential backoff parameters
INITIAL_BACKOFF = 1  # seconds
MAX_BACKOFF = 60  # seconds
BACKOFF_FACTOR = 2

# Track per-domain last-request timestamps (for fixed spacing)
domain_last_request = {}

# minimum delay between requests to the same domain
DOMAIN_DELAY = 1.0  # seconds

# Create a single Session with your custom User-Agent
session = requests.Session()
session.headers.update({"User-Agent": "not-the-news/1.0 (by /u/not-the-news-app)"})

# --- Constants for Redlib instances caching ---
INSTANCES_URL = "https://raw.githubusercontent.com/redlib-org/redlib-instances/refs/heads/main/instances.json"
REDIS_ETAG_KEY = "redlib_instances_etag"
REDIS_CONTENT_KEY = "redlib_instances_content"

def update_redlib_instances_cache():
    """
    Fetches the Redlib instances JSON file and caches it in Redis.
    Uses ETag to avoid re-downloading if the file hasn't changed.
    """
    print("Checking for Redlib instances update...")
    headers = {}
    try:
        # Get the last known ETag from Redis, if it exists
        last_etag = r.get(REDIS_ETAG_KEY)
        if last_etag:
            # The value in Redis is bytes, so decode it for the header
            headers["If-None-Match"] = last_etag.decode('utf-8')

        # Use the global session to make the request
        response = session.get(INSTANCES_URL, headers=headers)

        # 304 Not Modified: The cached version is up-to-date
        if response.status_code == 304:
            print("Redlib instances file is already up-to-date.")
            return

        # Raise an exception for other bad status codes (4xx or 5xx)
        response.raise_for_status()

        # 200 OK: New version downloaded, update cache
        new_etag = response.headers.get("ETag")
        # response.content is already bytes, which is what r.set expects
        r.set(REDIS_CONTENT_KEY, response.content)
        if new_etag:
            # new_etag is a string, so encode it before storing in Redis
            r.set(REDIS_ETAG_KEY, new_etag.encode('utf-8'))
        print("Successfully updated and cached Redlib instances.")

    except requests.exceptions.RequestException as e:
        print(f"Error fetching Redlib instances file: {e}")
    except Exception as e:
        print(f"An unexpected error occurred while updating Redlib instances: {e}")


def extract_domain(url, cache={}):
    """Extract the domain from a URL with basic caching."""
    if url in cache:
        return cache[url]
    parsed = urlparse(url)
    cache[url] = parsed.netloc
    return cache[url]


def fetch_with_backoff(url):
    """Fetch the URL, applying per-domain delay + retry/backoff on 429."""
    # ─── Redis cache lookup (skip all backoff/delays on cache hit) ─────────
    key = f"rss:{url}"
    cached = r.get(key)
    if cached:
        return feedparser.parse(cached)

    # 0) Global QPM rate-limit
    _consume_token()
    # 1) Domain-based delay
    domain = extract_domain(url)

    last = domain_last_request.get(domain, 0)
    now_ts = time.monotonic()
    extra_delay = max(0, DOMAIN_DELAY - (now_ts - last))
    if extra_delay > 0:
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"{ts}: [{domain}] waiting {extra_delay:.2f}s before request… {url}")
        time.sleep(extra_delay)
    domain_last_request[domain] = time.monotonic()

    # 2) Exponential retry/backoff loop
    backoff = INITIAL_BACKOFF
    while True:
        try:
            # re-apply rate limit on each retry
            _consume_token()
            resp = session.get(url)
            if resp.status_code == 429:
                # honor Retry-After if given, else use backoff
                ra = resp.headers.get("Retry-After")
                wait = int(ra) if ra and ra.isdigit() else backoff
                print(f"429 from {url}, sleeping {wait}s (backoff={backoff}s)…")
                time.sleep(wait)
                backoff = min(backoff * BACKOFF_FACTOR, MAX_BACKOFF)
                continue

            resp.raise_for_status()
            # ─── Cache the raw feed bytes for 1 hour ───────────────────────
            r.set(key, resp.content, ex=3600)
            return feedparser.parse(resp.content)

        except requests.RequestException as e:
            print(f"Error fetching {url}: {e}")
            return None


def validate_url(url):
    """Validate the structure of a URL."""
    parsed = urlparse(url)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)

def safe_xml(text):
    if not isinstance(text, str):
        return ""
    return re.sub(r'[\x00-\x08\x0B-\x0C\x0E-\x1F]', '', text)

def merge_feeds(feeds_file, output_file):
    """Fetch multiple RSS/Atom feeds, merge entries, and write to an output file."""
    total_entries = 0
    seen_entries = set()  # Store keys we've seen (link or fallback ID)

    fg = FeedGenerator()
    fg.title("Merged Feed")
    fg.link(href="http://example.com", rel="alternate")
    fg.description("This is a merged feed.")
    fg.language("en")
    fg.docs("http://www.rssboard.org/rss-specification")
    fg.generator("python-feedgen")

    # Read the list of feed URLs
    feed_urls = load_rss_feeds()

    # Sort feed URLs by their domain
    domain_cache = {}
    feed_urls.sort(key=lambda url: extract_domain(url, domain_cache))

    for url in feed_urls:
        if not validate_url(url):
            print(f"Skipping invalid URL: {url}")
            continue

        feed = fetch_with_backoff(url)
        if not feed or not feed.entries:
            print(f"No entries for {url}, skipping.")
            continue

        ts = datetime.now().strftime("%H:%M:%S")
        print(
            f"{ts}: Importing: {url} ({len(feed.entries)} entries)",
            end="\r",
            flush=True,
        )
        if len(feed.entries) == 0:
            print(
                f"Debug: No entries found in feed {url}. Feed content: {pprint.pformat(feed)}"
            )
            continue

        for entry in feed.entries:
            entry_link = entry.get("link")
            entry_title = entry.get("title", "")
            entry_published = entry.get("published", "")

            # Use link if available, otherwise fall back to title+published
            entry_key = entry_link if entry_link else f"{entry_title}_{entry_published}"
            if entry_key in seen_entries:
                continue  # Skip duplicates
            seen_entries.add(entry_key)

            fe = fg.add_entry()
            # generate a deterministic unique hash (GUID) for the entry
            hash_input = entry.get("id", entry.get("link", "")).encode("utf-8")
            unique_hash = hashlib.sha256(hash_input).hexdigest()
            fe.guid(unique_hash, permalink=False)
            fe.title(entry_title or "No Title")
            if entry_link:
                fe.link(href=entry_link, rel="alternate", type="text/html")

            # pick published or updated timestamp string
            date_str = entry.get("published") or entry.get("updated")
            if date_str:
                # parse into a datetime (handles RFC-822, ISO8601, etc.)
                pub_dt = parse(date_str)
            else:
                # fallback to a true datetime object
                pub_dt = datetime.now(timezone.utc)

            # feedgen.pubDate accepts a datetime, and will format it correctly
            fe.pubDate(pub_dt)

            # Prefer full HTML <content:encoded> if present, otherwise fallback to summary
            if "content" in entry and entry.content:
                raw_html = safe_xml(entry.content[0].value)
            else:
                raw_html = safe_xml(entry.get("summary", ""))

            # Emit the HTML inside a CDATA-wrapped <content:encoded> element
            # (so the downstream cleaner can pick up real <p>, <ul>, <li>, etc.)
            fe.content(raw_html, type="CDATA")

            total_entries += 1

    merged_feed = fg.rss_str(pretty=True)
    with open(output_file, "wb") as out:
        out.write(merged_feed)

    print()
    print(f"Merged feed saved to '{output_file}' with {total_entries} entries.")


if __name__ == "__main__":
    # On each run, check for and cache the latest Redlib instances
    update_redlib_instances_cache()

    parser = argparse.ArgumentParser(
        description="Merge multiple RSS/Atom feeds into one."
    )
    parser.add_argument(
        "--feeds", required=True, help="Path to the text file listing feed URLs."
    )
    parser.add_argument(
        "--output", required=True, help="Path to save the merged feed XML."
    )
    args = parser.parse_args()
    merge_feeds(args.feeds, args.output)