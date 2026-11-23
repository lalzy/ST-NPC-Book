// NPC Book — pure logic (no DOM / no SillyTavern imports). Testable in Node.

export const TRACKER_TAG = 'npcs';

const STOPWORDS = new Set(['the', 'and', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'is', 'was', 'with', 'for', 'her', 'his', 'she', 'he', 'they', 'year', 'years', 'old', 'yo']);

export function normalize(s) {
    return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s_-]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function slugify(s) {
    const slug = normalize(s).replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/^_+|_+$/g, '');
    return slug || 'npc';
}

export function uniqueId(base, taken) {
    let id = slugify(base);
    if (!taken(id)) return id;
    let n = 2;
    while (taken(`${id}_${n}`)) n++;
    return `${id}_${n}`;
}

export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Find the tracker block in a message.
 * Returns { found, json, raw, cleaned } where cleaned is the text with all tracker blocks removed.
 */
export function extractTracker(text) {
    const src = String(text ?? '');
    const re = new RegExp(`<${TRACKER_TAG}>([\\s\\S]*?)(?:</${TRACKER_TAG}>|$)`, 'gi');
    let last = null;
    let m;
    while ((m = re.exec(src)) !== null) {
        last = m;
        if (m[0].length === 0) re.lastIndex++;
    }
    if (!last) return { found: false, json: null, raw: '', cleaned: src, error: null };
    const cleaned = src.replace(re, '').replace(/\n{3,}/g, '\n\n').trimEnd();
    const raw = last[1];
    let json = null;
    let error = null;
    try {
        json = parseLenientJson(raw);
        if (json && !Array.isArray(json)) {
            if (Array.isArray(json.present)) json = json.present;
            else if (Array.isArray(json.npcs)) json = json.npcs;
            else if (typeof json === 'object') json = [json];
        }
    } catch (e) {
        error = e?.message || String(e);
        json = null;
    }
    return { found: true, json, raw, cleaned, error };
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
    s = s.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(s);
}

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

/** Default pronouns from a gender value: male → he/him, female → she/her, otherwise ''. */
export function defaultPronouns(gender) {
    const w = normalize(gender).split(' ');
    if (w.some(x => ['female', 'woman', 'girl', 'f'].includes(x))) return 'she/her';
    if (w.some(x => ['male', 'man', 'boy', 'm'].includes(x))) return 'he/him';
    return '';
}

/** Card profile fields (not identity traits: never used for matching). */
export const PROFILE_FIELDS = [
    { key: 'height', label: 'Height', attr: 'height' },
    { key: 'pronouns', label: 'Pronouns', attr: 'pronouns' },
    { key: 'sexualExperience', label: 'Sexual experience', attr: 'sexual_experience' },
];

/** Read profile fields from an LLM tracker entry (top level or inside "traits"). */
export function profileFromEntry(entry) {
    const tr = entry?.traits || {};
    const pick = (...vals) => String(vals.find(v => v !== undefined && v !== null && String(v).trim() !== '') ?? '').trim();
    const gender = Object.entries(tr).find(([k]) => normalize(k) === 'gender')?.[1];
    return {
        height: pick(entry?.height, tr.height),
        pronouns: pick(entry?.pronouns, tr.pronouns) || defaultPronouns(gender),
        sexualExperience: pick(entry?.sexual_experience, entry?.sexualExperience, tr.sexual_experience, tr.sexualExperience),
    };
}

const PROFILE_TRAIT_KEYS = new Set(['height', 'pronouns', 'sexual_experience', 'sexualexperience']);

export function pickEnum(value, list, fallback) {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const v = normalize(value);
    const hit = (list || []).find(x => normalize(x) === v);
    return hit ?? fallback;
}

/**
 * Apply a parsed tracker list to the previous roster.
 * Returns { roster, created: [template], log: [] }. Does not mutate inputs except library via createTemplate callback.
 */
export function normOutfitChange(entry) {
    const o = entry?.outfit;
    if (!o) return entry?.wear ? { wear: entry.wear } : null;
    if (Array.isArray(o)) return { wear: o };
    return o;
}

export function applyTracker(list, prevRoster, { library, threshold, numericTolerance, postures, states, conditions = ['Worn'], allowWardrobeGrowth = false, autoCreate = true, traitKeys = [], excludeNames = [] }) {
    const prev = Array.isArray(prevRoster) ? prevRoster : [];
    const presentIds = prev.map(i => i.id);
    const lib = { ...(library || {}) };
    const created = [];
    const updated = [];
    const log = [];
    const roster = [];
    const excluded = new Set(excludeNames.map(normalize).filter(Boolean));

    for (const entry of Array.isArray(list) ? list : []) {
        if (!entry || typeof entry !== 'object') continue;
        const nm = String(entry.name ?? '').trim();
        if (!nm && !entry.id) continue;
        if (nm && excluded.has(normalize(nm))) continue;

        let { id, reason, score } = resolveEntry(entry, { library: lib, presentIds, threshold, numericTolerance });
        if (!id) {
            if (!autoCreate) { log.push({ name: nm, action: 'skipped', reason }); continue; }
            const newId = uniqueId(entry.id || nm, x => !!lib[x]);
            const traits = {};
            for (const k of traitKeys) traits[k] = '';
            for (const [k, v] of Object.entries(entry.traits || {})) {
                const key = normalize(k).replace(/\s+/g, '_');
                if (PROFILE_TRAIT_KEYS.has(key)) continue; // stored as card fields, not identity traits
                traits[key] = String(v ?? '');
            }
            const wb = buildWardrobe(entry.wardrobe);
            const initial = applyOutfitChange([], wb.wardrobe, normOutfitChange(entry), conditions).outfit;
            const t = {
                id: newId,
                name: nm || newId,
                portrait: '',
                description: String(entry.description ?? '').trim(),
                details: String(entry.details ?? entry.description ?? '').trim(),
                traits,
                ...profileFromEntry(entry),
                wardrobe: wb.wardrobe,
                defaultWorn: initial.map(w => w.id),
                auto: true,
                created: Date.now(),
            };
            lib[newId] = t;
            created.push(t);
            id = newId;
            log.push({ name: t.name, action: 'created', id, reason });
        } else {
            log.push({ name: nm || lib[id]?.name, action: 'matched', id, reason, score });
        }
        if (roster.some(i => i.id === id)) continue;
        const before = prev.find(i => i.id === id);
        const tpl = lib[id];
        if (tpl && allowWardrobeGrowth && Array.isArray(entry.wardrobe) && !created.some(c => c.id === id)) {
            const grown = buildWardrobe(entry.wardrobe, tpl.wardrobe || []);
            if (grown.added.length) { lib[id] = { ...tpl, wardrobe: grown.wardrobe }; updated.push(lib[id]); }
        }
        const wardrobe = lib[id]?.wardrobe || [];
        const startOutfit = before?.outfit ?? outfitFromDefault(lib[id]?.defaultWorn, wardrobe, conditions);
        const oc = created.some(c => c.id === id)
            ? { outfit: startOutfit, rejected: [] }
            : applyOutfitChange(startOutfit, wardrobe, normOutfitChange(entry), conditions);
        if (oc.rejected.length) log.push({ name: nm, action: 'outfit-rejected', items: oc.rejected });
        roster.push({
            outfit: oc.outfit,
            id,
            name: lib[id]?.name ?? nm,
            posture: pickEnum(entry.posture, postures, before?.posture ?? postures?.[0] ?? ''),
            state: pickEnum(entry.state, states, before?.state ?? states?.[0] ?? ''),
            feelings: String(entry.feelings ?? entry.thoughts ?? before?.feelings ?? '').trim(),
        });
    }
    return { roster, created, updated: updated.filter(u => !created.some(c => c.id === u.id)), log };
}

// ───────────────────────── wardrobe / paperdoll ─────────────────────────

export const SLOTS = [
    { key: 'head', label: 'Head' },
    { key: 'neck', label: 'Neck' },
    { key: 'cover', label: 'Cover' },
    { key: 'upper_outer', label: 'Upper (outer)' },
    { key: 'upper_inner', label: 'Upper (inner)' },
    { key: 'hands', label: 'Hands' },
    { key: 'waist', label: 'Waist' },
    { key: 'lower_outer', label: 'Lower (outer)' },
    { key: 'lower_inner', label: 'Lower (inner)' },
    { key: 'feet_outer', label: 'Feet (outer)' },
    { key: 'feet_inner', label: 'Feet (inner)' },
    { key: 'other', label: 'Other' },
];
export const STACKING_SLOTS = new Set(['other']);
const SLOT_KEYS = new Set(SLOTS.map(s => s.key));

const SLOT_ALIASES_EXTRA = {
    cap: 'head', crown: 'head', tiara: 'head', circlet: 'head', helm: 'head', bandana: 'head', beret: 'head', headband: 'head', veil: 'head',
    choker: 'neck', pendant: 'neck', amulet: 'neck', neckerchief: 'neck', tie: 'neck',
    robe: 'cover', bathrobe: 'cover', poncho: 'cover', parka: 'cover', overcoat: 'cover', blazer: 'cover', cardigan: 'cover', breastplate: 'cover', cuirass: 'cover', mantle: 'cover', shawl: 'cover',
    tunic: 'upper_outer', blouse: 'upper_outer', sweater: 'upper_outer', jumper: 'upper_outer', vest: 'upper_outer', tee: 'upper_outer', tshirt: 'upper_outer', hoodie: 'upper_outer', corset: 'upper_outer', doublet: 'upper_outer', jerkin: 'upper_outer', apron: 'upper_outer', camisole: 'upper_inner', chemise: 'upper_inner', bralette: 'upper_inner', binder: 'upper_inner',
    glove: 'hands', gauntlet: 'hands', mitten: 'hands', bracer: 'hands',
    girdle: 'waist', cummerbund: 'waist',
    trouser: 'lower_outer', trousers: 'lower_outer', jean: 'lower_outer', jeans: 'lower_outer', short: 'lower_outer', shorts: 'lower_outer', legging: 'lower_outer', leggings: 'lower_outer', breeches: 'lower_outer', kilt: 'lower_outer', greaves: 'lower_outer',
    pantie: 'lower_inner', panty: 'lower_inner', knickers: 'lower_inner', boxers: 'lower_inner', boxer: 'lower_inner', thong: 'lower_inner', loincloth: 'lower_inner', undergarment: 'lower_inner', smallclothes: 'lower_inner',
    shoe: 'feet_outer', boot: 'feet_outer', sandal: 'feet_outer', slipper: 'feet_outer', heel: 'feet_outer', heels: 'feet_outer', sneaker: 'feet_outer', loafer: 'feet_outer', clog: 'feet_outer', moccasin: 'feet_outer', sabaton: 'feet_outer',
    sock: 'feet_inner', stocking: 'feet_inner', tights: 'feet_inner', pantyhose: 'feet_inner', footwrap: 'feet_inner',
    earring: 'other', bracelet: 'other', piercing: 'other', brooch: 'other', glasses: 'other', spectacles: 'other', anklet: 'other',
};
const SLOT_ALIASES = {
    hat: 'head', helmet: 'head', hood: 'head', hair: 'head',
    collar: 'neck', scarf: 'neck', necklace: 'neck',
    cloak: 'cover', coat: 'cover', jacket: 'cover', armor: 'cover', armour: 'cover', outerwear: 'cover', cape: 'cover',
    upper: 'upper_outer', top: 'upper_outer', torso: 'upper_outer', chest: 'upper_outer', shirt: 'upper_outer', upper_outer: 'upper_outer',
    bra: 'upper_inner', undershirt: 'upper_inner', upper_inner: 'upper_inner', upper_underwear: 'upper_inner',
    gloves: 'hands', hand: 'hands',
    belt: 'waist', sash: 'waist',
    lower: 'lower_outer', bottom: 'lower_outer', legs: 'lower_outer', pants: 'lower_outer', skirt: 'lower_outer', lower_outer: 'lower_outer',
    panties: 'lower_inner', underwear: 'lower_inner', briefs: 'lower_inner', lower_inner: 'lower_inner', lower_underwear: 'lower_inner',
    feet: 'feet_outer', shoes: 'feet_outer', boots: 'feet_outer', footwear: 'feet_outer', feet_outer: 'feet_outer',
    socks: 'feet_inner', stockings: 'feet_inner', feet_inner: 'feet_inner',
    accessory: 'other', accessories: 'other', jewelry: 'other', jewellery: 'other', ring: 'other', rings: 'other', misc: 'other',
};

Object.assign(SLOT_ALIASES, SLOT_ALIASES_EXTRA);

export function normalizeSlot(s) {
    const k = normalize(s).replace(/[()]/g, '').replace(/\s+/g, '_');
    if (SLOT_KEYS.has(k)) return k;
    if (SLOT_ALIASES[k]) return SLOT_ALIASES[k];
    // "upper outer", "outer upper", "feet (inner)" etc.
    const parts = k.split('_');
    for (const base of ['upper', 'lower', 'feet']) {
        if (parts.includes(base)) return `${base}_${parts.includes('inner') ? 'inner' : 'outer'}`;
    }
    return null;
}

export function normalizeSlots(list) {
    const arr = Array.isArray(list) ? list : (list ? [list] : []);
    const out = [];
    for (const s of arr) { const k = normalizeSlot(s); if (k && !out.includes(k)) out.push(k); }
    return out.length ? out : ['other'];
}

export function inferSlots(name) {
    for (const w of normalize(name).split(' ').reverse()) {
        const k = SLOT_ALIASES[w] || SLOT_ALIASES[w.replace(/s$/, '')];
        if (k) return [k];
    }
    if (/dress|gown|robe|jumpsuit|overall|pyjama|pajama|nightgown/.test(normalize(name))) return ['upper_outer', 'lower_outer'];
    return ['other'];
}

export function findItem(wardrobe, ref) {
    if (!ref) return null;
    const r = String(ref).trim().toLowerCase();
    const n = normalize(ref);
    return (wardrobe || []).find(i => i.id === r) || (wardrobe || []).find(i => normalize(i.name) === n) || null;
}

/** Build wardrobe items from LLM/raw data, giving each a unique id. */
export function buildWardrobe(rawItems, existing = []) {
    const out = [...existing];
    const added = [];
    for (const raw of Array.isArray(rawItems) ? rawItems : []) {
        const name = String(typeof raw === 'string' ? raw : raw?.name ?? '').trim();
        if (!name) continue;
        if (out.some(i => normalize(i.name) === normalize(name))) continue;
        const item = {
            id: uniqueId(raw?.id || name, x => out.some(i => i.id === x)),
            name,
            slots: (raw?.slots ?? raw?.slot) ? normalizeSlots(raw?.slots ?? raw?.slot) : inferSlots(name),
            note: String(raw?.note ?? raw?.description ?? '').trim(),
        };
        out.push(item);
        added.push(item);
    }
    return { wardrobe: out, added };
}

function conflicts(a, b) {
    return a.slots.some(s => !STACKING_SLOTS.has(s) && b.slots.includes(s));
}

/** Put on an item: anything occupying the same (non-stacking) slots comes off. */
export function wearItem(outfit, wardrobe, ref, condition) {
    const item = findItem(wardrobe, ref);
    if (!item) return { outfit, ok: false };
    const next = outfit.filter(w => {
        if (w.id === item.id) return false;
        const other = findItem(wardrobe, w.id);
        return !(other && conflicts(other, item));
    });
    next.push({ id: item.id, condition });
    return { outfit: next, ok: true };
}

/**
 * Apply an LLM outfit change {wear:[], remove:[], condition:{}} using ONLY items from the wardrobe.
 * Unknown items are ignored (and reported in `rejected`).
 */
export function applyOutfitChange(outfit, wardrobe, change, conditions) {
    let cur = Array.isArray(outfit) ? outfit.map(x => ({ ...x })) : [];
    const rejected = [];
    if (!change || typeof change !== 'object') return { outfit: cur, rejected };
    const defCond = conditions?.[0] ?? 'Worn';
    const list = v => (Array.isArray(v) ? v : (v ? [v] : []));
    for (const ref of list(change.remove)) {
        const item = findItem(wardrobe, ref);
        if (item) cur = cur.filter(w => w.id !== item.id);
        else if (String(ref).toLowerCase() === 'all') cur = [];
        else rejected.push(String(ref));
    }
    for (const ref of list(change.wear)) {
        const r = wearItem(cur, wardrobe, ref, defCond);
        if (r.ok) cur = r.outfit; else rejected.push(String(ref));
    }
    for (const [ref, cond] of Object.entries(change.condition || change.conditions || {})) {
        const item = findItem(wardrobe, ref);
        const w = item && cur.find(x => x.id === item.id);
        const c = pickEnum(cond, conditions, null);
        if (w && c) w.condition = c;
    }
    return { outfit: cur, rejected };
}

export function outfitFromDefault(defaultWorn, wardrobe, conditions) {
    let cur = [];
    for (const id of defaultWorn || []) cur = wearItem(cur, wardrobe, id, conditions?.[0] ?? 'Worn').outfit;
    return cur;
}

/** slotKey -> [{item, condition}] */
export function outfitBySlot(outfit, wardrobe) {
    const map = Object.fromEntries(SLOTS.map(s => [s.key, []]));
    for (const w of outfit || []) {
        const item = findItem(wardrobe, w.id);
        if (!item) continue;
        for (const s of item.slots) if (map[s]) map[s].push({ item, condition: w.condition });
    }
    return map;
}

// ───────────────────────── first-message character list ─────────────────────────

/**
 * Finds a starting-cast block in a greeting, e.g.
 *   ```json
 *   characters[ seraphina, sophia_housewife ]
 *   ```
 * Also accepts `characters: [...]`, `{"characters": [...]}`, quoted ids and names, with or without a code fence.
 * Returns { found, refs: [string], cleaned }.
 */
export function extractCharacterList(text) {
    const src = String(text ?? '');
    const patterns = [
        /```[a-z]*\s*\{?\s*"?characters"?\s*[:=]?\s*\[([\s\S]*?)\]\s*\}?\s*```/i,
        /\{\s*"characters"\s*:\s*\[([\s\S]*?)\]\s*\}/i,
        /(?:^|\n)[ \t]*characters\s*[:=]?\s*\[([^\]]*)\]/i,
    ];
    for (const re of patterns) {
        const m = src.match(re);
        if (!m) continue;
        const refs = m[1].split(/[,\n]/).map(x => x.trim().replace(/^["'`]+|["'`]+$/g, '').trim()).filter(Boolean);
        const cleaned = (src.slice(0, m.index) + src.slice(m.index + m[0].length)).replace(/\n{3,}/g, '\n\n').trim();
        return { found: true, refs, cleaned };
    }
    return { found: false, refs: [], cleaned: src };
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

/** Normalise a CSS/HTML color to lowercase #rrggbb (or '' if unknown). */
export function normColor(c) {
    let v = String(c ?? '').trim().toLowerCase().replace(/^["']|["']$/g, '');
    if (/^[0-9a-f]{6}$/.test(v) || /^[0-9a-f]{3}$/.test(v)) v = `#${v}`;
    if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
    const rgb = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgb) v = `#${[rgb[1], rgb[2], rgb[3]].map(x => Number(x).toString(16).padStart(2, '0')).join('')}`;
    return /^#[0-9a-f]{6}$/.test(v) ? v : '';
}

/**
 * Plain-language exposure summary from what is worn, e.g. "completely naked", "topless, barefoot",
 * "in underwear only". Returns '' when nothing notable is exposed.
 */
export function exposureSummary(outfit, wardrobe) {
    const by = outfitBySlot(outfit, wardrobe);
    const has = (k) => (by[k] || []).length > 0;
    const anything = SLOTS.some(s => has(s.key));
    if (!anything) return 'completely naked';
    const upperOuter = has('cover') || has('upper_outer');
    const upperInner = has('upper_inner');
    const lowerOuter = has('lower_outer');
    const lowerInner = has('lower_inner');
    const feet = has('feet_outer') || has('feet_inner');
    const out = [];
    const noUpper = !upperOuter && !upperInner;
    const noLower = !lowerOuter && !lowerInner;
    if (noUpper && noLower) out.push('naked except for accessories');
    else {
        if (noUpper) out.push('topless (bare chest)');
        else if (!upperOuter && upperInner) out.push('upper body in underwear only');
        if (noLower) out.push('bottomless (genitals exposed)');
        else if (!lowerOuter && lowerInner) out.push('lower body in underwear only');
        if (!upperOuter && !lowerOuter && upperInner && lowerInner) {
            out.splice(0, out.length, 'in underwear only');
        }
    }
    if (!feet) out.push('barefoot');
    return out.join(', ');
}
