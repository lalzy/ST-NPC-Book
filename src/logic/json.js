// NPC Book — pure logic (no DOM / no SillyTavern imports). Testable in Node.
// Lenient JSON reading for model output: repair, bracket matching, salvaging intact objects.

/**
 * Rescue the intact top-level {...} objects from broken JSON, e.g. an array where one entry is malformed
 * ("gender": 48, 48) or the generation was cut off mid-array. Broken objects are skipped.
 */
export function salvageObjects(text) {
    const s = String(text ?? '');
    const out = [];
    out.skipped = 0;
    out.repaired = 0;
    let depth = 0;
    let inStr = false;
    let start = -1;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) { if (ch === '\\') i++; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') { if (depth === 0) start = i; depth++; }
        else if (ch === '}' && depth > 0) {
            depth--;
            if (depth === 0 && start >= 0) {
                const chunk = s.slice(start, i + 1);
                let o = null;
                try { o = parseLenientJson(chunk); } catch {
                    o = dropBrokenParts(chunk);
                    if (o) out.repaired++;
                }
                if (o && typeof o === 'object' && !Array.isArray(o)) out.push(o); else out.skipped++;
                start = -1;
            }
        }
    }
    return out;
}

/** An entry that will not parse: retry with one nested object/array (an optional "gurps" sheet, say) replaced by null, last one first. */
function dropBrokenParts(chunk) {
    const s = String(chunk);
    const parts = [];
    let depth = 0;
    let inStr = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) { if (ch === '\\') i++; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{' || ch === '[') {
            if (depth === 1) { const end = matchBracket(s, i); if (end > i) { parts.push([i, end]); i = end; continue; } }
            depth++;
        } else if (ch === '}' || ch === ']') depth--;
    }
    for (const [a, b] of parts.reverse()) {
        try {
            const o = parseLenientJson(`${s.slice(0, a)}null${s.slice(b + 1)}`);
            if (o && typeof o === 'object' && !Array.isArray(o)) return o;
        } catch { /* try the next part */ }
    }
    return null;
}

export function parseLenientJson(raw) {
    let s = String(raw ?? '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    if (!s) return [];
    const start = s.search(/[[{]/);
    if (start > 0) s = s.slice(start);
    const endArr = s.lastIndexOf(']');
    const endObj = s.lastIndexOf('}');
    const end = Math.max(endArr, endObj);
    if (end >= 0) s = s.slice(0, end + 1);
    s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, '\'');
    return JSON.parse(quoteBareWords(stripTrailingCommas(s)));
}

/** Quote bare words outside strings: ["Melee", 11, A] → ["Melee", 11, "A"]. Numbers, true, false, null stay. */
export function quoteBareWords(json) {
    const s = String(json ?? '');
    const num = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    const word = /[A-Za-z_][A-Za-z0-9_-]*/y;
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '"') {
            let j = i + 1;
            while (j < s.length && s[j] !== '"') { if (s[j] === '\\') j++; j++; }
            out += s.slice(i, j + 1);
            i = j;
            continue;
        }
        if (/[-0-9.]/.test(ch)) {
            num.lastIndex = i;
            const m = num.exec(s);
            if (m) { out += m[0]; i += m[0].length - 1; } else out += ch;
            continue;
        }
        if (/[A-Za-z_]/.test(ch)) {
            word.lastIndex = i;
            const w = word.exec(s)[0];
            out += /^(true|false|null)$/.test(w) ? w : `"${w}"`;
            i += w.length - 1;
            continue;
        }
        out += ch;
    }
    return out;
}

/** Remove trailing commas before } or ] (models write them a lot); commas inside strings are left alone. */
export function stripTrailingCommas(json) {
    const s = String(json ?? '');
    let out = '';
    let inStr = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            out += ch;
            if (ch === '\\') { out += s[i + 1] ?? ''; i++; } else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; out += ch; continue; }
        if (ch === ',') {
            let j = i + 1;
            while (j < s.length && /\s/.test(s[j])) j++;
            if (s[j] === '}' || s[j] === ']') continue;
        }
        out += ch;
    }
    return out;
}

/** Index of the bracket closing the one at `open`, or -1. Double-quoted strings are skipped. */
export function matchBracket(s, open) {
    const stack = [];
    let inStr = false;
    for (let i = open; i < s.length; i++) {
        const ch = s[i];
        if (inStr) { if (ch === '\\') i++; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
        else if (ch === '}' || ch === ']') {
            if (stack.pop() !== ch) return -1;
            if (!stack.length) return i;
        }
    }
    return -1;
}
