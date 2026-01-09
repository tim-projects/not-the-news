You are an expert Cloudflare Worker developer tasked with implementing a demo deck system for an RSS reader app. The goal is to serve the 10 most relevant RSS items to unauthenticated users without incurring Firebase free tier reads, while keeping the data fresh via background updates.

## Core Requirements

**For unauthenticated users:**
1. Serve `/api/demo-deck.json` containing exactly 10 RSS items (pre-parsed JSON format)
2. Items should be: most starred OR least read across ALL users (aggregate stats)
3. **Fallback 1**: User's own items from localStorage (if available)
4. **Fallback 2**: Last known good demo deck from R2 (never live RSS parsing)
5. Zero Firebase reads per unauthenticated request (edge cache hits only)
6. Update every 5 minutes if data changes
7. "Show more" button clears deck → redirects to `/login`

**Technical constraints:**
- Firebase free tier + Cloudflare free tier only
- Client-side rendering with fallback logic
- No per-user backend costs
- **Client cannot parse raw RSS - all items must be pre-parsed JSON**

## Architecture to Implement

```
Cron Worker (*/5min) 
  ↓ queries Firebase aggregates (stars/read counts)
  ↓ generates pre-parsed JSON → writes demo-deck.json to R2  
  ↓ edge cache propagates (5min TTL)

Client Request (no auth)
  ↓ 1. Check localStorage items → use if available
  ↓ 2. GET /api/demo-deck.json (cache hit) 
  ↓ 3. render 10 items as RSS "deck"  
  ↓ "Show more" → localStorage.clear() → /login
```

## Tasks to Complete

### 1. Cron Worker (`demo-updater.js`)
```javascript
// Triggers: */5 * * * * 
export default {
  async scheduled(event, env) {
    // Query Firebase aggregates (stars, read counts across all users)
    // Generate top 10 pre-parsed items JSON
    // Write to R2 bucket if changed (idempotent)
    // Skip if no changes detected
  }
}
```

**Must handle:**
- Firebase Admin SDK authentication
- Aggregate query: `most starred OR least read` across all users/collections
- Generate identical JSON structure as main app (pre-parsed RSS items)
- Compare vs existing R2 file, write only if changed
- Error handling: log failures, don't break deployment
- **Never fetch live RSS in cron - only Firebase aggregates**

### 2. Demo API Route (`demo-api.js`)
```javascript
// GET /api/demo-deck.json
export default {
  async fetch(req, env) {
    // Check for auth token → bypass to personalized if present
    // Serve from R2: Cache-Control: public, max-age=300, stale-while-revalidate=600
    // 404 → serve bootstrap fallback JSON with 3 static popular items
  }
}
```

### 3. Client-side Integration (`app.js`)
```javascript
async function loadInitialDeck() {
  // 1. Check localStorage for user's own items first
  const localItems = localStorage.getItem('userItems');
  if (localItems && JSON.parse(localItems).length > 0) {
    renderDeck(JSON.parse(localItems));
    return;
  }
  
  // 2. Fetch demo deck
  try {
    const response = await fetch('/api/demo-deck.json');
    const deck = await response.json();
    renderDeck(deck.items);
  } catch(e) {
    renderFallbackDeck();
  }
}

// Show more handler
showMore.onclick = () => {
  localStorage.clear();
  window.location.href = '/login';
};
```

### 4. Deployment Config (wrangler.toml)
```toml
name = "rss-demo-deck"
compatibility_date = "2025-12-01"

[[r2_buckets]]
binding = "DEMO_BUCKET"
bucket_name = "rss-demo-deck-bucket"

[[triggers]]
crons = ["*/5 * * * *"]

[vars]
DEMO_JSON_PATH = "demo-deck.json"
```

### 5. R2 Bucket Setup
```
1. Create R2 bucket: rss-demo-deck-bucket (public access)
2. Upload initial demo-deck.json with 10 static popular items
3. Bind to Worker as DEMO_BUCKET
4. Set public access policy
```

## Success Metrics
- ✅ 100% unauth requests = edge cache hits (0 Firebase reads)
- ✅ Updates every 5min max when aggregate data changes
- ✅ localStorage → demo JSON → bootstrap fallback priority
- ✅ Stays within free tiers: ~300 cron runs/day + cached serves
- ✅ Pre-parsed JSON only (no client RSS parsing)

## Edge Cases to Handle
1. **localStorage has items** → render immediately (highest priority)
2. **Demo JSON unavailable** → serve bootstrap fallback from Worker
3. **Firebase query fails** → keep serving last known good R2 file
4. **R2 write fails** → log + retry next cron cycle
5. **No aggregate data** → rank by recency or static popular items
6. **Auth user hits demo** → bypass cache, serve personalized
7. **Client cache stale** → `stale-while-revalidate=600`

## Firebase Aggregate Query Logic
```
1. Query all users' starred items → count occurrences
2. Query all items' read counts → find least read
3. Score: (star_count * 3) + (inverse_read_count)
4. Sort descending → take top 10
5. Transform to app's item JSON format
```

## Page Rules (Cloudflare Dashboard)
```
URL: yourdomain.com/api/demo-deck.json
Cache Level: Cache Everything
Edge Cache TTL: 5 minutes
Browser Cache TTL: Respect Existing Headers
```

## Deliverables Expected
1. **Complete Worker code**: `demo-updater.js` + `demo-api.js`
2. **`wrangler.toml`** full configuration
3. **Client-side JS** integration (200 lines max)
4. **Firebase aggregate query** function
5. **R2 setup script** + initial JSON
6. **Cache headers** optimization
7. **Error monitoring** with Workers logs

**MANDATORY: Stay within free tiers. Zero per-user backend costs. Fresh aggregate data every 5 minutes. Pre-parsed JSON only.**
```
