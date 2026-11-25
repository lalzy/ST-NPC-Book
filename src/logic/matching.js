// NPC Book — pure logic (no DOM / no SillyTavern imports). Testable in Node.
// Identity matching: resolves tracker entries and references to library NPCs.

import { normalize } from './text.js';

const STOPWORDS = new Set(['the', 'and', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'is', 'was', 'with', 'for', 'her', 'his', 'she', 'he', 'they', 'year', 'years', 'old', 'yo']);

function words(s) {
    return normalize(s).split(' ').filter(w => w && !STOPWORDS.has(w) && (w.length > 2 || /^\d+$/.test(w)));
}

function asNumber(v) {
    const m = String(v ?? '').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
}

function valuesMatch(a, b, numericTolerance) {
    const na = asNumber(a), nb = asNumber(b);
    if (na !== null && nb !== null && /^\D*-?\d+(?:\.\d+)?\D*$/.test(String(a).trim()) && /^\D*-?\d+(?:\.\d+)?\D*$/.test(String(b).trim())) {
        return Math.abs(na - nb) <= numericTolerance;
    }
    const A = normalize(a), B = normalize(b);
    if (!A || !B) return false;
    if (A === B || A.includes(B) || B.includes(A)) return true;
    const wa = words(a), wb = new Set(words(b));
    if (!wa.length) return false;
    const hit = wa.filter(w => wb.has(w)).length;
    return hit / wa.length >= 0.5;
}

function foundInText(value, haystack, numericTolerance) {
    const hay = ` ${normalize(haystack)} `;
    const v = String(value ?? '').trim();
    if (/^\D*\d+(?:\.\d+)?\D*$/.test(v) && words(v).filter(w => !/^\d+$/.test(w)).length === 0) {
        const n = asNumber(v);
        const nums = (hay.match(/\d+(?:\.\d+)?/g) || []).map(Number);
        return nums.some(x => Math.abs(x - n) <= numericTolerance);
    }
    const ws = words(v);
    if (!ws.length) return false;
    const hit = ws.filter(w => hay.includes(` ${w} `) || hay.includes(` ${w}s `)).length;
    return hit / ws.length >= 0.5;
}

/**
 * Score how well reported traits match a template.
 * Returns null when there is no data to compare (nothing reported), else 0..1.
 */
export function traitScore(template, traits, { numericTolerance = 2 } = {}) {
    const reported = Object.entries(traits || {})
        .filter(([k, v]) => v !== null && v !== undefined && String(v).trim() !== '' && !['id', 'name'].includes(normalize(k)));
    if (!reported.length) return null;
    const tTraits = {};
    for (const [k, v] of Object.entries(template?.traits || {})) {
        if (v !== null && v !== undefined && String(v).trim() !== '') tTraits[normalize(k)] = v;
    }
    const haystack = [template?.description, template?.details, ...Object.values(template?.traits || {})].join(' \n ');
    let matched = 0;
    for (const [k, v] of reported) {
        const key = normalize(k);
        const ok = key in tTraits
            ? valuesMatch(v, tTraits[key], numericTolerance)
            : foundInText(v, haystack, numericTolerance);
        if (ok) matched++;
    }
    return matched / reported.length;
}

/**
 * Resolve a tracker entry to an existing template id, or null when a NEW character is needed.
 * Criteria: (1) ID or NAME must match exactly (case-insensitive), (2) reported data must reach the threshold.
 * Characters already present in the scene are matched by id without a data check.
 */
export function resolveEntry(entry, { library, presentIds = [], threshold = 0.5, numericTolerance = 2 }) {
    const rawId = String(entry?.id ?? '').trim().toLowerCase();
    const name = normalize(entry?.name);
    const lib = library || {};

    if (rawId && presentIds.includes(rawId) && lib[rawId]) {
        return { id: rawId, reason: 'present-id', score: null };
    }

    const candidates = [];
    if (rawId && lib[rawId]) candidates.push({ id: rawId, via: 'id' });
    if (name) {
        for (const t of Object.values(lib)) {
            if (normalize(t.name) === name && !candidates.some(c => c.id === t.id)) candidates.push({ id: t.id, via: 'name' });
        }
    }
    if (!candidates.length) return { id: null, reason: 'no-id-or-name-match', score: null };

    // Prefer present characters, then id matches.
    candidates.sort((a, b) => (presentIds.includes(b.id) - presentIds.includes(a.id)) || ((b.via === 'id') - (a.via === 'id')));

    let best = null;
    for (const c of candidates) {
        const score = traitScore(lib[c.id], entry?.traits, { numericTolerance });
        if (score === null) {
            // Nothing reported to compare. A present character or an id match is accepted.
            if (presentIds.includes(c.id) || c.via === 'id') return { id: c.id, reason: `${c.via}-no-data`, score };
            if (!best) best = { id: c.id, reason: 'name-no-data', score };
            continue;
        }
        if (score >= threshold && (!best || (best.score ?? -1) < score)) best = { id: c.id, reason: `${c.via}+data`, score };
    }
    if (best) return best;
    return { id: null, reason: 'data-mismatch', score: 0 };
}

/** Resolve an id-or-name reference against the library (id first, then exact name). */
export function resolveRef(ref, library) {
    const lib = library || {};
    const id = String(ref ?? '').trim().toLowerCase();
    if (lib[id]) return id;
    const n = normalize(ref);
    const hit = Object.values(lib).find(t => normalize(t.name) === n);
    return hit ? hit.id : null;
}

/** Edit distance between two strings (Levenshtein). */
function editDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return prev[b.length];
}

function ratio(a, b) {
    const n = Math.max(a.length, b.length);
    return n ? 1 - editDistance(a, b) / n : 0;
}

/**
 * How alike two names are, 0..1. 1 = same name. Handles spelling variants ("Lily" / "Lilly"),
 * partial names ("Lilly" / "Lilly Hart", "Captain Rhea" / "Rhea") and word order.
 */
export function nameSimilarity(a, b) {
    const A = normalize(a), B = normalize(b);
    if (!A || !B) return 0;
    if (A === B) return 1;
    const whole = ratio(A.replace(/[\s_-]+/g, ''), B.replace(/[\s_-]+/g, ''));
    const ta = A.split(/[\s_-]+/).filter(Boolean), tb = B.split(/[\s_-]+/).filter(Boolean);
    // Every word of the shorter name has a close partner in the longer one.
    const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    const per = short.map(w => Math.max(...long.map(x => ratio(w, x))));
    const avg = per.reduce((s, x) => s + x, 0) / per.length;
    // A partial name ("Lilly" for "Lilly Hart") scores a bit below a full match.
    const partial = avg * (short.length === long.length ? 1 : 0.92);
    return Math.max(whole, partial);
}

/** A trait value from a card or a tracker entry (inside "traits" or at the top level), by key, case-insensitive. */
function traitOf(x, key) {
    for (const src of [x?.traits, x]) {
        if (!src || typeof src !== 'object') continue;
        const hit = Object.entries(src).find(([k, v]) => normalize(k) === key && v !== null && v !== undefined && typeof v !== 'object' && String(v).trim());
        if (hit) return String(hit[1]);
    }
    return '';
}

/** 'm', 'f' or '' (unknown / other). */
function genderClass(v) {
    const w = normalize(v).split(' ');
    if (w.some(x => ['female', 'woman', 'girl', 'f', 'lady', 'feminine'].includes(x))) return 'f';
    if (w.some(x => ['male', 'man', 'boy', 'm', 'masculine'].includes(x))) return 'm';
    return '';
}

/** How alike two roles are, 0..1 ("wizard" / "Court Wizard" / "wizards" match). */
function roleSimilarity(a, b) {
    const A = normalize(a), B = normalize(b);
    if (!A || !B) return 0;
    const stem = w => w.replace(/(es|s)$/, '');
    const wa = A.split(' ').filter(w => w.length > 2).map(stem), wb = B.split(' ').filter(w => w.length > 2).map(stem);
    if (!wa.length || !wb.length) return 0;
    const hit = wa.filter(w => wb.some(x => x === w || ratio(w, x) >= 0.85)).length;
    return Math.max(hit / Math.min(wa.length, wb.length) * (hit === Math.max(wa.length, wb.length) ? 1 : 0.9), nameSimilarity(A, B));
}

/** 1 when every word of `role` appears in `text` (a normalized string padded with spaces), else 0. */
function roleInText(role, text) {
    const ws = normalize(role).split(' ').filter(w => w.length > 2);
    if (!ws.length || !text.trim()) return 0;
    return ws.every(w => text.includes(` ${w} `) || text.includes(` ${w}s `)) ? 1 : 0;
}

/**
 * Best matches for a character the LLM wrote (`entry`: name, traits) in a pool of cards ({ [id]: card }), best first.
 * A card is a candidate when its name is close (min..1), or its role matches the entry's role, name or description
 * ("Wizard", or a "traveling mage" described as a wizard, finds the library's wizard). A known gender that differs (female vs male) rules a card out.
 * Returns [{ id, score, name, role }] where name / role are the 0..1 parts that matched.
 */
export function identityCandidates(entry, pool, { min = 0.7, limit = 5 } = {}) {
    const name = String(entry?.name ?? '').trim();
    const eRole = traitOf(entry, 'role') || traitOf(entry, 'occupation');
    const eGender = genderClass(traitOf(entry, 'gender'));
    // The entry's own words about itself ("Elderly high elf wizard…"): a card's role found there counts as a role match.
    const eText = ` ${normalize([entry?.description, entry?.details, ...Object.values(entry?.traits || {}).filter(v => typeof v !== 'object')].join(' '))} `;
    const out = [];
    for (const t of Object.values(pool || {})) {
        if (!t?.id) continue;
        const tGender = genderClass(traitOf(t, 'gender'));
        if (eGender && tGender && eGender !== tGender) continue;
        const tRole = traitOf(t, 'role') || traitOf(t, 'occupation');
        const n = Math.max(nameSimilarity(name, t.name), nameSimilarity(name, t.id) * 0.98);
        // Role: the entry's role against the card's role, or a role-like name ("Wizard", "Gate Guard") against the card's role.
        const r = tRole ? Math.max(eRole ? roleSimilarity(eRole, tRole) : 0, roleSimilarity(name, tRole) * 0.95, roleInText(tRole, eText) * 0.9) : 0;
        const nameHit = n >= min, roleHit = r >= 0.8;
        if (!nameHit && !roleHit) continue;
        const genderBonus = eGender && tGender ? 0.05 : 0;
        const score = nameHit
            ? Math.min(1, n * 0.8 + r * 0.15 + genderBonus)
            : Math.min(0.85, r * 0.75 + genderBonus);
        out.push({ id: t.id, score, name: n, role: r });
    }
    out.sort((a, b) => b.score - a.score || String(pool[a.id].name).localeCompare(String(pool[b.id].name)));
    return out.slice(0, limit);
}

/** Name-only matches (kept for callers that have no identity data). Returns [{ id, score }]. */
export function nameCandidates(name, pool, opts) {
    return identityCandidates({ name }, pool, opts).filter(c => c.name >= (opts?.min ?? 0.7)).map(c => ({ id: c.id, score: c.name }));
}
