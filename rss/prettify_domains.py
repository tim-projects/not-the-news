# Certain websites don't present the rss feed entriies in the best way.
# This module checks if an rss item is from a certain domain and applies cosmetic tweaks to the entry.

import re
from urllib.parse import urlparse
from typing import List
import redis
import json

# ─── Redis client for reading cached data ────────────────────────────────────
try:
    r = redis.Redis(host="localhost", port=6379, db=0)
    r.ping()
    _redis_available = True
except redis.exceptions.ConnectionError:
    print("Warning: Could not connect to Redis. Reddit links will use a fallback domain.")
    r = None
    _redis_available = False

# ─── Constants and Cache for Redlib domain ────────────────────────────────────
REDIS_CONTENT_KEY = "redlib_instances_content"
FALLBACK_DOMAIN = "safereddit.com"
_redlib_domain_cache = None # In-memory cache for the domain for a single script run

# punctuation title split priority: full stop, then ?, then :, then -, then comma
_SPLIT_PUNCTUATION = [".", "?", ":", "-", ","]


def get_redlib_domain():
    """
    Retrieves the first Redlib instance domain from the Redis cache.
    Falls back to a default if the cache is unavailable or invalid.
    Caches the result in memory for the duration of the script's run.
    """
    global _redlib_domain_cache
    # If we've already figured it out during this run, don't query Redis again.
    if _redlib_domain_cache:
        return _redlib_domain_cache

    if not _redis_available:
        _redlib_domain_cache = FALLBACK_DOMAIN
        return FALLBACK_DOMAIN

    try:
        cached_content = r.get(REDIS_CONTENT_KEY)
        if not cached_content:
            print("Warning: Redlib instances not found in Redis cache. Using fallback.")
            _redlib_domain_cache = FALLBACK_DOMAIN
            return FALLBACK_DOMAIN

        # The content is stored as bytes, so decode it before parsing
        instances_data = json.loads(cached_content.decode('utf-8'))
        
        # Safely get the first instance and its URL
        first_instance = instances_data.get("instances", [])[0]
        instance_url = first_instance.get("url")

        if instance_url:
            # Parse the URL to get just the hostname (e.g., "eu.safereddit.com")
            domain = urlparse(instance_url).hostname
            _redlib_domain_cache = domain
            return domain
        else:
            print("Warning: First Redlib instance in cache has no URL. Using fallback.")
            _redlib_domain_cache = FALLBACK_DOMAIN
            return FALLBACK_DOMAIN

    except (json.JSONDecodeError, IndexError) as e:
        print(f"Error processing Redlib data from Redis: {e}. Using fallback.")
        _redlib_domain_cache = FALLBACK_DOMAIN
        return FALLBACK_DOMAIN


def _split_segment(text: str, max_len: int = 60) -> List[str]:
    text = text.strip()
    if len(text) <= max_len:
        return [text]

    # look only in the first max_len characters
    window = text[: max_len + 1]

    # find the last occurrence of each punctuation in priority order
    split_pos = None
    for p in _SPLIT_PUNCTUATION:
        idx = window.rfind(p)
        if idx > 0:
            # for .,?,:,- include the punctuation in the left chunk
            split_pos = idx + 1
            break

    # if we found none, just hard‑split at max_len
    if split_pos is None:
        split_pos = max_len

    left = text[:split_pos].strip()
    right = text[split_pos:].strip()

    # recurse on the remainder
    return [left] + _split_segment(right, max_len)


def wrap_title(entry: dict, max_len: int = 60) -> str:
    """
    Split `title` into logical chunks ≤ max_len characters,
    then wrap the first chunk in <h1> and the rest in <h2>.
    """
    title = entry.get("title", "")
    link = entry.get("link", "#")
    parts = title.split(" — ")

    return "".join(
        [f'<h1><a href="{link}" target="_blank">{parts[0]}</a></h1>']
        + [f"<h2>{part}</h2>" for part in parts[1:]]
    )


def prettify_reddit_entry(entry):
    # Get the current Redlib domain from Redis cache (or fallback)
    redlib_domain = get_redlib_domain()

    # derive a clean source_url from the original link (reddit.com/r/<subreddit>)
    raw_link = entry.get("link", "").strip()
    m = re.search(r"(reddit\.com/r/[^/]+)", raw_link)
    source_url = m.group(1) if m else raw_link
    
    if "reddit.com" in source_url:
        source_url = source_url.replace("reddit.com", redlib_domain)
    elif "old.reddit.com" in source_url:
        source_url = source_url.replace("old.reddit.com", redlib_domain)

    # wrap it in a hidden <span> instead of an HTML comment
    metadata_tag = f'<span class="source-url">{source_url}</span>'

    desc = entry.get("description", "")
    if "[link]" in desc:
        match = re.search(r'<a href="([^"]+)">\[link\]</a>', desc)
        if match:
            entry["domain"] = match.group(1)

    if "<![CDATA[" in desc:
        # insert the span immediately after the CDATA open
        entry["description"] = desc.replace("<![CDATA[", "<![CDATA[" + metadata_tag, 1)
    else:
        # fallback: append to whatever the description is
        entry["description"] = desc + metadata_tag
    return entry


def prettify_hackernews_entry(entry):
    """Strip trailing ' | Hacker News' from titles."""
    title = entry.get("title", "").strip()
    link = entry.get("link", "")
    suffix = " | Hacker News"
    if title.endswith(suffix):
        entry["title"] = title[: -len(suffix)]
    return entry


def prettify_x_entry(entry):
    """Redirect x.com links to xcancel.com."""
    link = entry.get("link", "").strip()
    if "x.com" in link:
        # Replace domain inline, preserving path
        entry["link"] = link.replace("x.com", "xcancel.com")
    return entry


def prettify_wired_entry(entry):
    # derive a clean source_url from the original link (wired.com)
    source_url = entry.get("link", "").strip()
    
    # wrap it in a hidden <span> instead of an HTML comment
    metadata_tag = f'<span class="source-url">{source_url}</span>'

    desc = entry.get("description", "")
    if "<![CDATA[" in desc:
        # insert the span immediately after the CDATA open
        entry["description"] = desc.replace("<![CDATA[", "<![CDATA[" + metadata_tag, 1)
    else:
        # fallback: append to whatever the description is
        entry["description"] = desc + metadata_tag
    # Wrap wired.com links via removepaywalls.com proxy.
    link = entry.get("link", "").strip()
    if "wired.com" in link:
        # Insert removepaywalls.com before the original URL
        entry["link"] = link.replace(
            "www.wired.com", "removepaywalls.com/https://www.wired.com"
        )
    return entry


def prettify_images(entry):
    """Add lazy loading to images and wrap them in anchor tags."""
    description = entry.get("description", "")

    # Replace each <img ... src="URL" ...> with a clickable, lazy-loaded image
    def repl(match):
        attrs = match.group(1) or ""
        url = match.group(2)
        suffix = match.group(3) or ""
        img_tag = f'<img loading="lazy"{attrs}src="{url}"{suffix}>'
        return f'<a href="{url}">{img_tag}</a>'

    new_desc = re.sub(r'<img([^>]*?)src="([^"]+)"([^>]*?)>', repl, description)
    entry["description"] = new_desc
    return entry


# Dispatcher
def prettify_domains(entry):
    # Global post-processing: images
    entry = prettify_images(entry)
    # Wrap crazy long titles
    new_title = wrap_title(entry, max_len=60)
    entry["title"] = new_title

    """
    Inspect entry['link'], figure out the domain,
    and call the corresponding prettify function.
    """
    link = entry.get("link", "")
    hostname = ""
    try:
        hostname = urlparse(link).hostname or ""
    except Exception:
        pass

    # Normalize to just the main domain
    domain = hostname.lower().removeprefix("www.")

    if "reddit.com" in domain:
        return prettify_reddit_entry(entry)
    if "news.ycombinator.com" in domain:
        return prettify_hackernews_entry(entry)
    if "x.com" in domain:
        return prettify_x_entry(entry)
    if "wired.com" in domain:
        return prettify_wired_entry(entry)
    # add more domains here:
    # if domain == 'twitter.com': return prettify_twitter_entry(entry)

    return entry