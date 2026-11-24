// Portrait prompt building (template or LLM-written tag line).

import { ctx, hasChat } from '../core/context.js';
import { profileOf, traitSummary } from '../core/npcs.js';
import { settings } from '../core/settings.js';
import { findItem, outfitFromDefault } from '../logic/outfit.js';
import { currentRoster } from '../scene/roster.js';
import { recentStory } from '../scene/story.js';

export function cleanForImagine(x) {
    return String(x ?? '').replace(/[|{}"\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Data about an NPC for portrait prompts: details, identity, what they wear right now, posture/state. */
function portraitData(t) {
    const s = settings();
    const inst = hasChat() ? currentRoster().find(i => i.id === t.id) : null;
    const outfit = inst?.outfit ?? outfitFromDefault(t.defaultWorn, t.wardrobe || [], s.conditions);
    const wearing = (outfit || []).map(w => {
        const it = findItem(t.wardrobe || [], w.id);
        if (!it) return null;
        return `${it.name}${w.condition && w.condition !== s.conditions[0] ? ` (${w.condition})` : ''}`;
    }).filter(Boolean).join(', ');
    const labeled = settings().traitKeys.map(k => (t.traits?.[k] ? `${k}: ${t.traits[k]}` : null)).filter(Boolean).join('; ');
    return {
        name: t.name,
        identity: labeled,
        height: profileOf(t).height,
        description: String(t.description || '').trim(),
        traits: traitSummary(t),
        details: String(t.details || '').trim(),
        outfit: wearing || (t.wardrobe?.length ? 'nothing' : ''),
        posture: inst?.posture || '',
        state: inst?.state || '',
    };
}

function fillPortraitTemplate(tpl, d) {
    return String(tpl || '')
        .replaceAll('{{name}}', d.name)
        .replaceAll('{{char}}', d.name)
        .replaceAll('{{traits}}', d.traits)
        .replaceAll('{{details}}', d.details)
        .replaceAll('{{outfit}}', d.outfit)
        .replaceAll('{{posture}}', d.posture)
        .replaceAll('{{state}}', d.state);
}

/** Turn the LLM's answer into a single tag line (drop reasoning, quotes, labels). */
function extractTagLine(text) {
    let t = String(text ?? '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```[a-z]*|```/gi, '');
    const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const tagged = lines.filter(l => /^(solo|1girl|1boy|portrait)\b/i.test(l.replace(/^["'*\s]+/, '')));
    let line = (tagged.length ? tagged[tagged.length - 1] : lines[lines.length - 1]) || '';
    line = line.replace(/^(output|final|prompt|answer)\s*:\s*/i, '').replace(/^["'`*]+|["'`*]+$/g, '').trim();
    return line;
}

/** Always frame as a portrait: drop close-up tags, put the portrait prefix first, de-duplicate tags. */
function framePortrait(line) {
    const s = settings();
    if (!s.portraitFraming) return line;
    const tags = [...String(s.portraitPrefix || '').split(','), ...String(line || '').split(',')]
        .map(x => x.trim())
        .filter(x => x && !/\b(extreme\s+)?close[\s-]?up\b/i.test(x));
    const seen = new Set();
    return tags.filter(x => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).join(', ');
}

export async function portraitPromptFor(t) {
    const s = settings();
    const d = portraitData(t);
    if (s.portraitMode !== 'llm') return framePortrait(cleanForImagine(fillPortraitTemplate(s.portraitPrompt, { ...d, details: d.details.slice(0, 400) })));
    const system = fillPortraitTemplate(s.portraitLlmPrompt, d);
    const data = [
        'CHARACTER DATA',
        `Name: ${d.name}`,
        d.identity && `Identity: ${d.identity}`,
        d.height && `Height: ${d.height}`,
        d.details && `Details: ${d.details}`,
        d.description && `Notes: ${d.description}`,
        d.outfit && `Wearing right now: ${d.outfit}`,
        d.posture && `Posture: ${d.posture}`,
        d.state && `State: ${d.state}`,
        '',
        'LATEST STORY MESSAGES',
        recentStory() || '(none)',
    ].filter(x => typeof x === 'string').join('\n');
    const answer = await ctx().generateRaw({ systemPrompt: system, prompt: `${data}\n\nFollow the instructions and output only the final line.` });
    const line = framePortrait(cleanForImagine(extractTagLine(answer)));
    return line;
}
