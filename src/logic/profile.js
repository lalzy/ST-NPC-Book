// NPC Book — pure logic (no DOM / no SillyTavern imports). Testable in Node.
// Card profile fields (height, pronouns, sexuality) read from tracker entries.

import { normalize } from './text.js';

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
    { key: 'sexuality', label: 'Sexuality', attr: 'sexuality' },
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
        sexuality: pick(entry?.sexuality, entry?.sexual_orientation, entry?.orientation, tr.sexuality, tr.sexual_orientation, tr.orientation),
        sexualExperience: pick(entry?.sexual_experience, entry?.sexualExperience, tr.sexual_experience, tr.sexualExperience),
    };
}

export const PROFILE_TRAIT_KEYS = new Set(['height', 'pronouns', 'sexuality', 'sexual_orientation', 'orientation', 'sexual_experience', 'sexualexperience']);
