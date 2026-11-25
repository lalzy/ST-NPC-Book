// NPC Book — pure logic (no DOM / no SillyTavern imports). Testable in Node.
// Finds and parses the <npcs> tracker block in a reply.

import { matchBracket, parseLenientJson, runsToEnd, salvageObjects } from './json.js';

export const TRACKER_TAG = 'npcs';

function toTrackerList(json) {
    if (json && typeof json === 'object' && !Array.isArray(json)) {
        // A wrapper object ({"npcs": [...]}, {"characters": [...], "new": [...]}): use every list of entries in it.
        const lists = Object.values(json).filter(v => Array.isArray(v) && v.length && v.every(x => x && typeof x === 'object' && !Array.isArray(x)));
        if (lists.length && !('id' in json) && !('name' in json)) return lists.flat();
        if (Object.values(json).some(v => Array.isArray(v) && !v.length) && !('id' in json) && !('name' in json)) return [];
        return [json];
    }
    return json;
}

/**
 * Find the tracker block in a message.
 * Normal case: one <npcs>...</npcs> block at the end, which is removed from the text.
 * Smaller models sometimes forget the tags (a bare [{"id": ...}] array), forget a closing tag, "correct" themselves
 * several times ("Wait, let me fix that…" + another array), break one entry, or get cut off mid-array.
 * Then everything from the first attempt to the end of the message is removed, and the LAST array that yields
 * entries is used: parsed whole if it is valid JSON, otherwise its intact entries are rescued one by one.
 * Returns { found, json, raw, cleaned, error }.
 */
export function extractTracker(text) {
    const src = String(text ?? '');
    const TAG = /<npcs\b[^>]*>/i;
    const tagAt = src.search(TAG);
    // A bare block: a line starting with [ or { whose first entry has an "id", "name" or "new" key.
    const bare = /(^|\n)[ \t]*(?=[[{]\s*[[{]?\s*"(?:id|name|new|npcs|characters)"\s*:)/.exec(src);
    const bareAt = bare ? bare.index + bare[1].length : -1;
    const starts = [tagAt, bareAt].filter(x => x >= 0);
    if (!starts.length) return { found: false, json: null, raw: '', cleaned: src, error: null, truncated: false };
    const start = Math.min(...starts);

    // Every top-level array from the first attempt on (arrays inside entries, e.g. a wardrobe, are skipped).
    const arrays = [];
    const re = /\[\s*[{\]]/g;
    re.lastIndex = start;
    let m;
    while ((m = re.exec(src)) !== null) {
        const close = matchBracket(src, m.index);
        const end = close < 0 ? src.length : close + 1;
        arrays.push({ raw: src.slice(m.index, end), truncated: close < 0 && runsToEnd(src, m.index) });
        if (close < 0) break;
        re.lastIndex = end;
    }

    // One clean block followed by nothing tracker-like: remove just that block. Otherwise drop the whole tail.
    const blockRe = /<npcs\b[^>]*>[\s\S]*?<\/npcs>/gi;
    const blocks = src.match(blockRe) || [];
    const single = tagAt === start && blocks.length === 1 && arrays.length <= 1 && (src.match(/<npcs\b[^>]*>/gi) || []).length === 1;
    const cleaned = (single ? src.replace(/<npcs\b[^>]*>[\s\S]*?<\/npcs>/i, '') : src.slice(0, start))
        .replace(/\n?```[a-z]*\s*$/i, '') // a code fence the block was wrapped in
        .replace(/\n{3,}/g, '\n\n').trimEnd();
    const removed = single ? (src.match(/<npcs\b[^>]*>[\s\S]*?<\/npcs>/i)?.[0] ?? '') : src.slice(start);

    const tryParse = (raw, truncated, rescue = true) => {
        try {
            const json = toTrackerList(parseLenientJson(raw));
            if (Array.isArray(json)) return { found: true, json, raw, cleaned, removed, error: null, truncated };
        } catch { /* fall through to rescue */ }
        if (!rescue) return null;
        const salvaged = salvageObjects(raw);
        const rescued = salvaged.flatMap(o => toTrackerList(o));
        return rescued.length ? { found: true, json: rescued, raw, cleaned, removed, error: null, truncated, skipped: salvaged.skipped, repaired: salvaged.repaired } : null;
    };
    // 1) A complete, valid <npcs> block (last one first); this also reads wrapper objects with several lists.
    const closed = [...src.matchAll(/<npcs\b[^>]*>([\s\S]*?)<\/npcs>/gi)].map(x => x[1]).reverse();
    for (const body of closed) {
        if (/<npcs\b/i.test(body)) continue;
        const hit = tryParse(body, false, false);
        if (hit) return hit;
    }
    // 2) The last array that yields entries, rescuing intact entries from a broken or cut-off one.
    for (let i = arrays.length - 1; i >= 0; i--) {
        const hit = tryParse(arrays[i].raw, arrays[i].truncated);
        if (hit) return hit;
    }
    // 3) No usable array: a single object, a wrapper object, or tag content.
    const bodies = [...src.matchAll(/<npcs\b[^>]*>([\s\S]*?)(?:<\/npcs>|(?=<npcs\b)|$)/gi)].map(x => x[1]).reverse();
    for (const body of [...bodies, src.slice(start)]) {
        const hit = tryParse(body, !/<\/npcs>/i.test(src.slice(start)) && runsToEnd(body, body.search(/[[{]/)));
        if (hit) return hit;
    }
    return { found: true, json: null, raw: src.slice(start), cleaned, removed, error: 'no readable entries', truncated: runsToEnd(src, src.slice(start).search(/[[{]/) + start) };
}
