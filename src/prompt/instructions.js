// Builds the {{npcInstructions}} tracking prompt and the speaker-block reminder.

import { DEFAULT_USER_RULE, TRAIT_SAMPLES } from '../constants.js';
import { ctx, excludedNames, hasChat } from '../core/context.js';
import { traitSummary } from '../core/npcs.js';
import { extensions } from '../core/runtime.js';
import { lib, settings } from '../core/settings.js';
import { unusedTemplates } from '../logic/instances.js';
import { resolveRef } from '../logic/matching.js';
import { SLOTS } from '../logic/slots.js';
import { normalize } from '../logic/text.js';
import { promptScene } from '../scene/roster.js';

function extInstructions() {
    const out = [];
    for (const ext of extensions.values()) {
        if (typeof ext.instructions !== 'function') continue;
        try { const t = ext.instructions({ autoCreate: settings().autoCreate }); if (t) out.push(String(t)); } catch (e) { console.warn(e); }
    }
    return out;
}

export function buildInstructionText() {
    const s = settings();
    if (!s.enabled || !hasChat()) return '';
    const c = ctx();
    const keys = s.traitKeys.length ? s.traitKeys : ['race', 'age', 'gender', 'role'];
    // Known NPCs: everyone this chat has met (its instances), then library templates it has not used yet.
    const scene = promptScene();
    const line = (t) => { const tr = traitSummary(t); return `${t.id}: ${t.name}${tr ? ` — ${tr}` : ''}`; };
    const byName = (a, b) => String(a.name).localeCompare(String(b.name));
    const libLines = [
        ...Object.values(scene.instances).sort(byName).map(line),
        ...(s.includeLibrary ? Object.values(unusedTemplates(scene, lib())).sort(byName).map(line) : []),
    ];
    return String(s.instructions || '')
        .replaceAll('[[SPEAKER_RULE]]', s.enabled && s.speakerPortraits ? s.speakerRule : '')
        .replaceAll('[[OUTFIT_RULES]]', [s.trackOutfits ? s.outfitRules : '', s.trackUser ? DEFAULT_USER_RULE : '', s.trackRelationships ? s.relationshipRule : '', ...extInstructions()].filter(Boolean).join('\n'))
        .replaceAll('[[USER_EXAMPLE]]', s.trackUser ? `,\n  {"id": "user", "posture": "${s.postures[1] ?? s.postures[0] ?? 'Sitting'}"}` : '')
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
        .replaceAll('[[ATTITUDES]]', (s.attitudes || []).join(', '))
        .replaceAll('[[REL_TYPES]]', (s.relationshipTypes || []).join(', '))
        .replaceAll('[[LIBRARY]]', libLines.length ? libLines.join('\n') : '(none yet)');
}

/** Ids of the characters the next reply may voice: the scene, plus the main character when it is tracked. */
function speakerIds() {
    const c = ctx();
    const scene = promptScene();
    const ids = [...scene.active];
    if (settings().trackChar && c.characterId !== undefined && !c.groupId && c.name2) {
        const id = resolveRef(c.name2, scene.instances) ?? resolveRef(c.name2, lib());
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
