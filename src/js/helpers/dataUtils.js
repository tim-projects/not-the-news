export function mapRawItem(item, fmtFn) {
    if (!item) {
        console.warn("mapRawItem received an undefined or null item. Returning null.");
        return null;
    }

    // --- DEBUG LOG ENTRY START ---
    console.log(`[DEBUG] Processing item titled: "${item.title}". Raw description:`, item.desc);
    // --- DEBUG LOG ENTRY END ---

    const parser = new DOMParser();
    const doc = parser.parseFromString(item.desc || "", "text/html");

    const imgEl = doc.querySelector("img");
    const imgSrc = imgEl?.src || "";
    imgEl?.remove();

    let sourceUrl = "";
    const sourceEl = doc.querySelector(".source-url") || doc.querySelector("a");
    if (sourceEl) {
        sourceUrl = sourceEl.textContent.trim();
        sourceEl.remove();
    } else {
        sourceUrl = item.link ? new URL(item.link).hostname : "";
    }

    const descContent = doc.body.innerHTML.trim();
    const ts = Date.parse(item.pubDate) || 0;

    return {
        id: item.guid,
        image: imgSrc,
        title: item.title,
        link: item.link,
        pubDate: fmtFn(item.pubDate || ""),
        description: descContent,
        source: sourceUrl,
        timestamp: ts
    };
}