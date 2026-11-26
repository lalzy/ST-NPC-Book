// Builds the {{npcInstructions}} tracking prompt and the speaker-block reminder.

import { DEFAULT_USER_RULE, TRAIT_SAMPLES } from '../constants.js';
import { ctx, excludedNames, hasChat } from '../core/context.js';
import { extsWith, pipe } from '../core/extHooks.js';
import { fieldInstructions, fieldKey, identityFieldPrompts } from '../core/fields.js';
import { extensions } from '../core/runtime.js';
import { allTemplates } from '../core/libraries.js';
import { lib, settings } from '../core/settings.js';
import { resolveRef } from '../logic/matching.js';
import { SLOTS } from '../logic/slots.js';
import { normalize } from '../logic/text.js';
import { promptUser, userInScene } from '../scene/persona.js';
import { promptScene } from '../scene/roster.js';

function extInstructions() {
    const out = [];
    for (const ext of extsWith('instructions')) {
        try { const t = ext.instructions({ autoCreate: settings().autoCreate }); if (t) out.push(String(t)); } catch (e) { console.warn(e); }
    }
    return out;
}

export function buildInstructionText() {
    const s = settings();
    if (!s.enabled || !hasChat()) return '';
    const c = ctx();
    const baseKeys = s.traitKeys.length ? s.traitKeys : ['race', 'age', 'gender', 'role'];
    // Identity fields from sister extensions (API 12) are asked for like the Identity keys, under their prompt name.
    const keys = [...baseKeys, ...identityFieldPrompts().filter(k => !baseKeys.some(b => fieldKey(b) === fieldKey(k)))];
    // Known NPCs: only the people this chat has met (its instances), by id and name. Library templates are never sent:
    // the LLM brings in whoever it needs and the tracker matches the name (see findLookups). Details of an NPC are sent
    // only through {{npcScene}}, while that NPC is in the scene.
    const scene = promptScene();
    const trackUser = s.trackUser && userInScene(promptUser());
    const byName = (a, b) => String(a.name).localeCompare(String(b.name));
    const libLines = Object.values(scene.instances).sort(byName).map(t => `${t.id}: ${t.name}`);
    const text = String(s.instructions || '')
        .replaceAll('[[SPEAKER_RULE]]', s.enabled && s.speakerPortraits ? s.speakerRule : '')
        .replaceAll('[[OUTFIT_RULES]]', [s.trackOutfits ? s.outfitRules : '', trackUser ? DEFAULT_USER_RULE : '', fieldInstructions(), ...extInstructions()].filter(Boolean).join('\n'))
        .replaceAll('[[USER_EXAMPLE]]', trackUser ? `,\n  {"id": "user", "posture": "${s.postures[1] ?? s.postures[0] ?? 'Sitting'}"}` : '')
        .replaceAll('[[MAX_NEW]]', String(Number(s.maxNewPerReply) > 0 ? Number(s.maxNewPerReply) : 2))
        .replaceAll('[[CONDITIONS]]', s.conditions.join(', '))
        .replaceAll('[[SLOTS]]', SLOTS.map(x => x.key).join(', '))
        .replaceAll('[[EXCLUDE]]', excludedNames().join(' and ') || 'the user')
        .replaceAll('[[USER]]', c.name1 || 'the user')
        .replaceAll('[[CHAR]]', c.name2 || 'the main character')
        .replaceAll('[[POSTURES]]', s.postures.join(', '))
        .replaceAll('[[STATES]]', s.states.join(', '))
        .replaceAll('[[TRAIT_KEYS]]', keys.join(', '))
        .replaceAll('[[TRAIT_EXAMPLE]]', keys.map(k => `"${k}": "${TRAIT_SAMPLES[normalize(k)] ?? 'unknown'}"`).join(', '))
        .replaceAll('[[LIBRARY]]', libLines.length ? libLines.join('\n') : '(none yet)');
    // Sister extensions: their own [[PLACEHOLDERS]], then transformInstructions. Without any, the text is unchanged.
    return String(pipe('transformInstructions', extPlaceholders(text), { autoCreate: s.autoCreate }) ?? '');
}

/** Fill [[KEY]] placeholders that sister extensions define (def.placeholders = { KEY: () => string }). */
function extPlaceholders(text) {
    let out = text;
    for (const ext of extensions.values()) {
        const ph = ext?.placeholders;
        if (!ph || typeof ph !== 'object') continue;
        for (const [key, fn] of Object.entries(ph)) {
            const tag = `[[${key}]]`;
            if (!out.includes(tag)) continue;
            let v = '';
            try { v = typeof fn === 'function' ? fn() : fn; } catch (e) { console.warn(`[NPC Book] extension ${ext.id} placeholder ${key} failed`, e); }
            out = out.replaceAll(tag, String(v ?? ''));
        }
    }
    return out;
}

/** Ids of the characters the next reply may voice: the scene, plus the main character when it is tracked. */
function speakerIds() {
    const c = ctx();
    const scene = promptScene();
    const ids = [...scene.active];
    if (settings().trackChar && c.characterId !== undefined && !c.groupId && c.name2) {
        const id = resolveRef(c.name2, scene.instances) ?? resolveRef(c.name2, allTemplates());
        if (id && !ids.includes(id)) ids.unshift(id);
    }
    return ids;
}

export function buildSpeakerReminder() {
    const s = settings();
    const text = String(s.speakerReminder || '').trim();
    if (!s.enabled || !s.speakerPortraits || !text || !hasChat()) return '';
    const ids = speakerIds();
    return ids.length ? text.replaceAll('[[IDS]]', ids.join(', ')) : '';
}
