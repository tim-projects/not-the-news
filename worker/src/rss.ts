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

function prettifyItem(item: any): any {
    const domain = extractDomain(item.link || '');
    
    // Default prettification: wrap title
    item.title = wrapTitle(item.title || 'No Title', item.link || '#');

    // Domain specific logic
    if (domain.includes('reddit.com')) {
        item.source = 'Reddit';
        // Add Reddit specific logic here (e.g. Redlib proxy)
    } else if (domain.includes('news.ycombinator.com')) {
        item.title = (item.title || '').replace(' | Hacker News', '');
    } else if (domain.includes('x.com')) {
        item.link = (item.link || '').replace('x.com', 'xcancel.com');
    } else if (domain.includes('wired.com')) {
        item.link = (item.link || '').replace('www.wired.com', 'removepaywalls.com/https://www.wired.com');
    }

    // Image logic: find first image in description
    const imgMatch = item.description?.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch) {
        item.image = imgMatch[1];
    }

    const beforeLen = item.description?.length || 0;
    item.description = cleanHtml(item.description || '');
    const afterLen = item.description?.length || 0;
    
    if (beforeLen > 0 && afterLen === 0) {
        console.log(`[RSS] WARNING: Sanitization removed entire description for item: ${item.title}`);
    }
    
    return item;
}

export async function processFeeds(feedUrls: string[], blacklist: string[]): Promise<FeedItem[]> {
    const allItems: FeedItem[] = [];
    const seenGuids = new Set<string>();
    const normalizedBlacklist = blacklist.map(kw => String(kw).toLowerCase().trim()).filter(kw => kw.length > 0);

    for (const url of feedUrls) {
        try {
            console.log(`[RSS] Fetching: ${url}`);
            const feed = await parser.parseURL(url);
            
            for (const entry of feed.items) {
                const guid = entry.guid || entry.link || '';
                if (!guid || seenGuids.has(guid)) continue;

                // Keyword filtering
                const title = entry.title || '';
                const rawDescription = entry['content:encoded'] || entry.content || entry.description || entry.summary || '';
                const description = typeof rawDescription === 'string' ? rawDescription : (entry.contentSnippet || '');
                const searchableText = `${title} ${description}`.toLowerCase();
                
                const isBlacklisted = normalizedBlacklist.some(kw => searchableText.includes(kw));
                if (isBlacklisted) {
                    console.log(`[RSS] Filtering blacklisted item: ${title.substring(0, 50)}...`);
                    continue;
                }

                seenGuids.add(guid);
                const pubDate = entry.isoDate || entry.pubDate || new Date().toISOString();
                
                if (!description) {
                    console.log(`[RSS] WARNING: No description found for item: ${title}`);
                }

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
                allItems.push(item as FeedItem);
            }
        } catch (error) {
            console.error(`[RSS] Failed to process ${url}:`, error);
        }
    }

    // Sort by timestamp descending
    return allItems.sort((a, b) => b.timestamp - a.timestamp);
}
