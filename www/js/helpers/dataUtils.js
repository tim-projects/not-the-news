export function formatDate(dateStr) {
    const now = new Date();
    const date = new Date(dateStr);
    const secs = Math.floor((now - date) / 1000);
    const TWO_WEEKS_SECS = 2 * 7 * 24 * 60 * 60;

    if (secs > TWO_WEEKS_SECS) {
        return date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }

    const mins = Math.floor(secs / 60);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);

    if (secs < 60) return "Just now";
    if (mins < 60) return `${mins} minute${mins !== 1 ? "s" : ""} ago`;
    if (hrs < 24) return `${hrs} hour${hrs !== 1 ? "s" : ""} ago`;
    if (days < 7) return `${days} day${days !== 1 ? "s" : ""} ago`;

    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks !== 1 ? "s" : ""} ago`;
}

export function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

export function mapRawItems(rawList, fmtFn) {
    return rawList.map(item => {
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
    }).sort((a, b) => b.timestamp - a.timestamp);
}