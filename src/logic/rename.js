// NPC Book — pure logic (no DOM / no SillyTavern imports). Testable in Node.
// Rewrites a reply after the tracker decided who its characters are: speaker-block ids and character names.

function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** A display name without stray punctuation ("Gandalf the gray!" → "Gandalf the gray"). */
function cleanName(s) { return String(s ?? '').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''); }

function firstWord(s) { return cleanName(s).split(/\s+/)[0] || ''; }

/** Replace every whole-word `from` (case-sensitive, so ids in tags and other words stay as they are). */
function replaceWord(text, from, to) {
    if (!from || from === to) return text;
    return text.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escRe(from)}(?![\\p{L}\\p{N}_])`, 'gu'), to);
}

/**
 * Point speaker blocks at the real ids: <npc id="generated"> / <npc id="aldric"> → <npc id="gandalf">.
 * `idMap`: { writtenId: finalId }. Ids are compared case-insensitively.
 */
export function remapSpeakerIds(text, idMap) {
    const map = new Map(Object.entries(idMap || {}).map(([k, v]) => [String(k).toLowerCase(), v]));
    if (!map.size) return String(text ?? '');
    return String(text ?? '').replace(/(<npc\b[^>]*?\bid\s*=\s*)(["']?)([^"'\s>]+)\2/gi, (m, pre, q, id) => {
        const to = map.get(id.toLowerCase());
        return to && to !== id ? `${pre}${q || '"'}${to}${q || '"'}` : m;
    });
}

/**
 * Rename a character in the story text: the full name, then the first name alone
 * ("Aldric Stormcrow" → "Gandalf the gray", "Aldric" → "Gandalf"). Possessives follow ("Aldric's" → "Gandalf's").
 */
export function renameInText(text, fromName, toName) {
    const from = cleanName(fromName), to = cleanName(toName);
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) return String(text ?? '');
    let out = String(text ?? '');
    if (from.includes(' ')) out = replaceWord(out, from, to);
    const f1 = firstWord(from), t1 = firstWord(to);
    if (f1 && t1 && f1.toLowerCase() !== t1.toLowerCase()) out = replaceWord(out, f1, from.includes(' ') ? t1 : (to.includes(' ') ? t1 : to));
    return out;
}

/** True when `name` (or its first word) appears as a whole word in any of the texts. */
export function nameMentioned(name, texts) {
    const n = cleanName(name);
    if (!n) return false;
    const res = [n, firstWord(n)].filter(Boolean).map(x => new RegExp(`(?<![\\p{L}\\p{N}_])${escRe(x)}(?![\\p{L}\\p{N}_])`, 'iu'));
    return (texts || []).some(t => res.some(re => re.test(String(t ?? ''))));
}

const ATTR_RE = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/**
 * Speaker tags may only hold an id: <npc id="ID">. Some models stuff character data into the tag
 * (<npc id="x" name="..." new="true" posture="..." wardrobe='[...]'>), which breaks it. Each such tag is cut back to
 * its id, and the data it held is returned as tracker-like entries ({ id, name, new, posture, ... }) so nothing is lost.
 * Returns { text, entries }.
 */
export function sanitizeSpeakerTags(text) {
    const entries = [];
    const out = String(text ?? '').replace(/<npc\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi, (m, body) => {
        const attrs = {};
        for (const a of body.matchAll(ATTR_RE)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
        const keys = Object.keys(attrs);
        if (keys.length <= 1 && /^\s*id\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)\s*$/i.test(body)) return m;
        const id = attrs.id || attrs.name || '';
        if (keys.some(k => k !== 'id')) {
            const e = { id: attrs.id || '' };
            for (const [k, v] of Object.entries(attrs)) {
                if (k === 'id') continue;
                if (k === 'new') { e.new = /^(true|1|yes)$/i.test(v); continue; }
                if (k === 'wardrobe' || k === 'outfit' || k === 'traits') {
                    const t = v.trim();
                    if (/^[[{]/.test(t)) { try { e[k] = JSON.parse(t); continue; } catch { /* plain text below */ } }
                    if (k === 'outfit') { e.outfit = { wear: t.split(',').map(x => x.trim()).filter(Boolean) }; continue; }
                    if (k === 'traits') { e.description = [e.description, t].filter(Boolean).join(' — '); continue; }
                }
                e[k] = v;
            }
            entries.push(e);
        }
        return `<npc id="${String(id).replace(/["<>]/g, '')}">`;
    });
    return { text: out, entries };
}
