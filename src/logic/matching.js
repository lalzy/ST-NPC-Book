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
