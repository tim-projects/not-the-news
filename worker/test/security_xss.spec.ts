import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processFeeds } from '../src/rss';

// Mock fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe('Security XSS Check', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should strip script tags', async () => {
        const maliciousXml = `
            <rss version="2.0">
                <channel>
                    <title>Malicious Feed</title>
                    <item>
                        <title>Script Attack</title>
                        <description>Safe content <script>alert('XSS')</script></description>
                        <guid>1</guid>
                    </item>
                </channel>
            </rss>
        `;
        
        fetchMock.mockResolvedValue({
            ok: true,
            body: {
                getReader: () => {
                    const encoder = new TextEncoder();
                    const stream = new ReadableStream({
                        start(controller) {
                            controller.enqueue(encoder.encode(maliciousXml));
                            controller.close();
                        }
                    });
                    return stream.getReader();
                }
            }
        });

        const items = await processFeeds(['http://malicious.com/rss'], []);
        const item = items[0];
        
        expect(item.description).not.toContain('<script>');
        expect(item.description).not.toContain('alert(\'XSS\')');
    });

    it('should strip javascript: URIs in attributes', async () => {
        const maliciousXml = `
            <rss version="2.0">
                <channel>
                    <title>Malicious Feed</title>
                    <item>
                        <title>Attribute Attack</title>
                        <description>
                            <a href="javascript:alert(1)">Click me</a>
                            <img src="javascript:alert(1)" />
                        </description>
                        <guid>2</guid>
                    </item>
                </channel>
            </rss>
        `;

        fetchMock.mockResolvedValue({
            ok: true,
            body: {
                getReader: () => {
                    const encoder = new TextEncoder();
                    const stream = new ReadableStream({
                        start(controller) {
                            controller.enqueue(encoder.encode(maliciousXml));
                            controller.close();
                        }
                    });
                    return stream.getReader();
                }
            }
        });

        const items = await processFeeds(['http://malicious.com/rss'], []);
        const item = items[0];

        // Sanitize-html should remove the whole attribute or the protocol
        expect(item.description).not.toContain('href="javascript:alert(1)"');
        expect(item.description).not.toContain('src="javascript:alert(1)"');
    });

    it('should strip onerror attributes', async () => {
        const maliciousXml = `
            <rss version="2.0">
                <channel>
                    <title>Malicious Feed</title>
                    <item>
                        <title>Onerror Attack</title>
                        <description>
                            <img src="x" onerror="alert(1)" />
                        </description>
                        <guid>3</guid>
                    </item>
                </channel>
            </rss>
        `;

        fetchMock.mockResolvedValue({
            ok: true,
            body: {
                getReader: () => {
                    const encoder = new TextEncoder();
                    const stream = new ReadableStream({
                        start(controller) {
                            controller.enqueue(encoder.encode(maliciousXml));
                            controller.close();
                        }
                    });
                    return stream.getReader();
                }
            }
        });

        const items = await processFeeds(['http://malicious.com/rss'], []);
        const item = items[0];

        expect(item.description).not.toContain('onerror');
    });

    it('should strip iframe tags', async () => {
        const maliciousXml = `
            <rss version="2.0">
                <channel>
                    <title>Malicious Feed</title>
                    <item>
                        <title>Iframe Attack</title>
                        <description>
                            <iframe src="http://malicious.com"></iframe>
                        </description>
                        <guid>4</guid>
                    </item>
                </channel>
            </rss>
        `;

        fetchMock.mockResolvedValue({
            ok: true,
            body: {
                getReader: () => {
                    const encoder = new TextEncoder();
                    const stream = new ReadableStream({
                        start(controller) {
                            controller.enqueue(encoder.encode(maliciousXml));
                            controller.close();
                        }
                    });
                    return stream.getReader();
                }
            }
        });

        const items = await processFeeds(['http://malicious.com/rss'], []);
        const item = items[0];

        expect(item.description).not.toContain('<iframe');
    });
});
