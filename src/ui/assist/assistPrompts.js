// LLM assist: prompt building and answer parsing for card fields and wardrobes.

import { settings } from '../../core/settings.js';
import { parseLenientJson } from '../../logic/json.js';
import { SLOTS, inferSlots, normalizeSlots } from '../../logic/slots.js';
import { normColor, normalize } from '../../logic/text.js';
import { recentStory } from '../../scene/story.js';
import { libState } from '../library/state.js';
import { ASSIST_FIELDS, assist, readCardEditor } from './assistState.js';

export function assistJson(text) {
    const t = String(text ?? '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
    return parseLenientJson(t);
}

function cardContextLines(cur) {
    const out = [];
    const id = Object.entries(cur.identity).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('; ');
    if (cur.name) out.push(`Name: ${cur.name}`);
    if (id) out.push(`Identity: ${id}`);
    for (const [k, label] of [['height', 'Height'], ['pronouns', 'Pronouns'], ['sexuality', 'Sexuality'], ['sexual_experience', 'Sexual experience'], ['description', 'Description'], ['details', 'Details']]) {
        if (cur[k]) out.push(`${label}: ${cur[k]}`);
    }
    return out;
}

export function buildCardAssist(refine) {
    const s = settings();
    const c = assist.card;
    const fields = ASSIST_FIELDS.filter(f => c.fields.has(f.key));
    if (!fields.length) throw new Error('pick at least one field');
    const keys = s.traitKeys.length ? s.traitKeys : ['race', 'age', 'gender', 'role'];
    const shape = {};
    for (const f of fields) shape[f.key] = f.key === 'identity' ? Object.fromEntries(keys.map(k => [k, '...'])) : '...';
    const lines = [];
    if (c.useCard) {
        const ctxLines = cardContextLines(readCardEditor());
        if (ctxLines.length) lines.push('CURRENT CARD', ...ctxLines, '');
    }
    if (c.useChat) lines.push('RECENT CHAT', recentStory(6, 4000) || '(none)', '');
    if (refine) lines.push('YOUR PREVIOUS ANSWER', JSON.stringify(c.result), '', 'CHANGE REQUEST', c.prompt.trim());
    else lines.push('REQUEST', c.prompt.trim() || '(no extra wishes: make it fit the card)');
    lines.push('', 'Write these fields:', ...fields.map(f => `- ${f.key}: ${f.hint}${f.key === 'identity' ? ` (${keys.join(', ')})` : ''}`));
    lines.push('', 'Answer with exactly this JSON shape:', JSON.stringify(shape, null, 2));
    return { systemPrompt: s.assistCardPrompt, prompt: lines.join('\n') };
}

export function readCardAnswer(json) {
    const c = assist.card;
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('the answer was not a JSON object');
    const pick = (...ks) => { for (const k of ks) if (json[k] !== undefined && json[k] !== null && String(json[k]).trim() !== '') return json[k]; return undefined; };
    const res = {};
    for (const f of ASSIST_FIELDS) {
        if (!c.fields.has(f.key)) continue;
        if (f.key === 'identity') {
            const src = json.identity && typeof json.identity === 'object' ? json.identity : json.traits && typeof json.traits === 'object' ? json.traits : null;
            if (!src) continue;
            const keys = [...new Set([...settings().traitKeys, ...Object.keys(readCardEditor().identity)])];
            const id = {};
            for (const k of keys) { const hit = Object.entries(src).find(([sk]) => normalize(sk) === normalize(k)); if (hit && String(hit[1] ?? '').trim()) id[k] = String(hit[1]).trim(); }
            if (Object.keys(id).length) res.identity = id;
            continue;
        }
        let v = f.key === 'sexual_experience' ? pick('sexual_experience', 'sexualExperience') : pick(f.key);
        if (v === undefined) continue;
        v = String(v).trim();
        if (f.key === 'color') { v = normColor(v); if (!v) continue; }
        res[f.key] = v;
    }
    if (!Object.keys(res).length) throw new Error('the answer did not contain any of the requested fields');
    c.result = res;
    c.accept = new Set(Object.keys(res));
}

export function buildWardrobeAssist(refine) {
    const s = settings();
    const w = assist.wardrobe;
    const cur = readCardEditor();
    const existing = (libState.draftWardrobe?.wardrobe || []).map(i => `${i.name} [${i.slots.join(', ')}]`);
    const lines = ['CHARACTER', ...(cardContextLines(cur).length ? cardContextLines(cur) : ['(no details yet)']), ''];
    if (w.mode === 'add' && existing.length) lines.push('ALREADY IN THE WARDROBE (do not repeat these)', existing.join('; '), '');
    if (refine) lines.push('YOUR PREVIOUS ANSWER', JSON.stringify({ items: w.result.items.map(({ name, slots, note }) => ({ name, slots, note })) }), '', 'CHANGE REQUEST', w.prompt.trim());
    else lines.push('REQUEST', w.prompt.trim() || '(no extra wishes: a practical, fitting everyday wardrobe)');
    lines.push('', `Suggest about ${Math.max(1, Number(w.count) || 8)} items.`);
    if (w.cover) lines.push('Make sure the set includes underwear (upper_inner, lower_inner), something to sleep in, and footwear.');
    if (w.start) lines.push('Also list, in "starting", the item names this character wears right now (one per slot at most).');
    const shape = { items: [{ name: 'Green wool dress', slots: ['upper_outer', 'lower_outer'], note: 'optional, short' }] };
    if (w.start) shape.starting = ['Green wool dress'];
    lines.push(`Valid slots: ${SLOTS.map(x => x.key).join(', ')}.`, '', 'Answer with exactly this JSON shape:', JSON.stringify(shape, null, 2));
    return { systemPrompt: s.assistWardrobePrompt, prompt: lines.join('\n') };
}

export function readWardrobeAnswer(json) {
    const w = assist.wardrobe;
    const raw = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : null;
    if (!raw) throw new Error('the answer had no "items" list');
    const owned = new Set((libState.draftWardrobe?.wardrobe || []).map(i => normalize(i.name)));
    const items = [];
    for (const r of raw) {
        const name = String(typeof r === 'string' ? r : r?.name ?? '').trim();
        if (!name || items.some(x => normalize(x.name) === normalize(name))) continue;
        const slots = (r?.slots ?? r?.slot) ? normalizeSlots(r.slots ?? r.slot) : inferSlots(name);
        items.push({ name, slots, note: String(r?.note ?? '').trim(), take: !owned.has(normalize(name)) });
    }
    if (!items.length) throw new Error('the answer had no items');
    const starting = new Set();
    for (const ref of Array.isArray(json?.starting) ? json.starting : []) {
        const i = items.findIndex(x => normalize(x.name) === normalize(ref));
        if (i >= 0) starting.add(i);
    }
    w.result = { items, starting };
}
