// LLM assist: prompt building and answer parsing for card fields.

import { settings } from '../../core/settings.js';
import { parseLenientJson } from '../../logic/json.js';
import { normColor, normalize } from '../../logic/text.js';
import { recentStory } from '../../scene/story.js';
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
