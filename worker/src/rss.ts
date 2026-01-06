import Parser from 'rss-parser';
import sanitizeHtml from 'sanitize-html';

const parser = new Parser();

export interface FeedItem {
    guid: string;
    title: string;
    link: string;
    pubDate: string;
    description: string;
    source: string;
    image: string;
    timestamp: number;
}

const ALLOWED_TAGS = [
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "li", "strong", "em", "a", "br", "div", "img", "span"
];

const ALLOWED_ATTRIBUTES = {
    "a": ["href", "rel", "target"],
    "img": ["loading", "src", "alt", "title"],
    "span": ["class", "style"],
};

function cleanHtml(html: string): string {
    return sanitizeHtml(html, {
        allowedTags: ALLOWED_TAGS,
        allowedAttributes: ALLOWED_ATTRIBUTES,
    });
}

function extractDomain(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

function wrapTitle(title: string, link: string): string {
    const parts = title.split(" — ");
    let html = `<h1><a href="${link}" target="_blank">${parts[0]}</a></h1>`;
    for (let i = 1; i < parts.length; i++) {
        html += `<h2>${parts[i]}</h2>`;
    }
    return html;
}

export function prettifyItem(item: any): any {
    const domain = extractDomain(item.link || '');
    
    // Domain specific logic before wrapping title
    if (domain.includes('reddit.com')) {
        const subredditMatch = (item.link || '').match(/\/r\/([^/]+)/i);
        const subreddit = subredditMatch ? subredditMatch[1] : '';
        item.source = subreddit ? `Reddit/r/${subreddit}` : 'Reddit';

        // Extract real link from Reddit description if available
        // Reddit RSS usually has the content link in the description as <a href="...">[link]</a>
        const linkMatch = item.description?.match(/<a href="([^"]+)">\[link\]<\/a>/i);
        if (linkMatch) {
            const realLink = linkMatch[1];
            
            // Check for image or video
            if (realLink.includes('i.redd.it') || realLink.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
                // Prepend image if not already there (often Reddit RSS has it anyway, but let's be sure)
                const escapedLink = realLink.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const hasImgTag = new RegExp(`<img[^>]+src=["']${escapedLink}["']`, 'i').test(item.description);
                
                if (!hasImgTag) {
                    item.description = `<img src="${realLink}" /><br/>` + item.description;
                }
            } else if (realLink.includes('v.redd.it')) {
                // v.redd.it handling
                item.description = `<video controls><source src="${realLink}" type="video/mp4"></video><br/>` + item.description;
            }

            item.link = realLink;
            // Hide the [link] text from description
            item.description = item.description.replace(/<a href="[^"]+">\[link\]<\/a>/i, '');
        }
    } else if (domain.includes('news.ycombinator.com')) {
        item.title = (item.title || '').replace(' | Hacker News', '');
    } else if (domain.includes('x.com')) {
        item.link = (item.link || '').replace('x.com', 'xcancel.com');
    } else if (domain.includes('wired.com')) {
        item.link = (item.link || '').replace('www.wired.com', 'removepaywalls.com/https://www.wired.com');
    }

    // Default prettification: wrap title
    item.title = wrapTitle(item.title || 'No Title', item.link || '#');

    // Image logic: find first image in description
    const imgMatch = item.description?.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch) {
        item.image = imgMatch[1];
        // Remove this image from the description to prevent duplicate display in the client
        // We look for the whole tag that contains the URL
        const imgTagRegex = new RegExp(`<img[^>]+src=["']${imgMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'ig');
        item.description = item.description.replace(imgTagRegex, '');
    }

    const beforeLen = item.description?.length || 0;
    item.description = cleanHtml(item.description || '');
    const afterLen = item.description?.length || 0;
    
    if (beforeLen > 0 && afterLen === 0) {
        console.log(`[RSS] WARNING: Sanitization removed entire description for item: ${item.title}`);
    }

    // Post-sanitize cleanup for gaps
    item.description = (item.description || '').trim();
    item.description = item.description.replace(/^<br\s*\/?>/i, '');
    item.description = item.description.replace(/<p><\/p>/gi, '');
    item.description = item.description.replace(/<div><\/div>/gi, '');
    
    return item;
}

export async function processFeeds(feedUrls: string[], blacklist: string[]): Promise<FeedItem[]> {
    const allItems: FeedItem[] = [];
    const seenGuids = new Set<string>();
    const normalizedBlacklist = blacklist.map(kw => String(kw).toLowerCase().trim()).filter(kw => kw.length > 0);

    // Fetch in parallel batches to avoid timeouts and stay under Cloudflare limits
    const BATCH_SIZE = 25;
    for (let i = 0; i < feedUrls.length; i += BATCH_SIZE) {
        const batch = feedUrls.slice(i, i + BATCH_SIZE);
        console.log(`[RSS] Processing batch ${i / BATCH_SIZE + 1} (${batch.length} feeds)`);

        const results = await Promise.all(batch.map(async (url) => {
            try {
                // Security: Set timeout and max size for fetching
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

                const response = await fetch(url, { 
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
                    }
                });
                clearTimeout(timeout);

                if (!response.ok) return [];

                // Security: Limit response size to 2MB
                const reader = response.body?.getReader();
                if (!reader) return [];

                let chunks = [];
                let totalSize = 0;
                const MAX_RSS_SIZE = 2 * 1024 * 1024; // 2MB

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    totalSize += value.length;
                    if (totalSize > MAX_RSS_SIZE) {
                        controller.abort();
                        return [];
                    }
                    chunks.push(value);
                }

                const blob = new Blob(chunks);
                const xml = await blob.text();
                const feed = await parser.parseString(xml);
                
                const feedItems: FeedItem[] = [];
                for (const entry of feed.items) {
                    const guid = entry.guid || entry.link || '';
                    if (!guid) continue;

                    // Keyword filtering
                    const title = entry.title || '';
                    const rawDescription = entry['content:encoded'] || entry.content || entry.description || entry.summary || '';
                    const description = typeof rawDescription === 'string' ? rawDescription : (entry.contentSnippet || '');
                    const searchableText = `${title} ${description}`.toLowerCase();
                    
                    const isBlacklisted = normalizedBlacklist.some(kw => searchableText.includes(kw));
                    if (isBlacklisted) continue;

                    const pubDate = entry.isoDate || entry.pubDate || new Date().toISOString();
                    
                    let item: any = {
                        guid,
                        title: entry.title,
                        link: entry.link,
                        pubDate,
                        description: description,
                        source: feed.title || extractDomain(entry.link || ''),
                        image: '',
                        timestamp: new Date(pubDate).getTime()
                    };

                    item = prettifyItem(item);
                    feedItems.push(item as FeedItem);
                }
                return feedItems;
            } catch (error) {
                console.error(`[RSS] Failed to process ${url}:`, error);
                return [];
            }
        }));

        // Flatten results and deduplicate
        for (const feedItems of results) {
            for (const item of feedItems) {
                if (!seenGuids.has(item.guid)) {
                    seenGuids.add(item.guid);
                    allItems.push(item);
                }
            }
        }
    }

    // Sort by timestamp descending
    return allItems.sort((a, b) => b.timestamp - a.timestamp);
}
