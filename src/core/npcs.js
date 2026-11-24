// NPC card (template) helpers: lookup, profile fields, trait summary, color picking.

import { COLOR_PALETTE } from '../constants.js';
import { defaultPronouns } from '../logic/profile.js';
import { lib, settings } from './settings.js';

export function pickColor() {
    const used = new Set(Object.values(lib()).map(t => String(t.color || '').toLowerCase()));
    const free = COLOR_PALETTE.filter(c => !used.has(c));
    const pool = free.length ? free : COLOR_PALETTE;
    return pool[Math.floor(Math.random() * pool.length)];
}

export function portraitUrl(t) { return t?.portrait || ''; }

/** Profile fields of a card; pronouns fall back to the gender default when empty. */
export function profileOf(t) {
    return {
        height: String(t?.height ?? '').trim(),
        pronouns: String(t?.pronouns ?? '').trim() || defaultPronouns(t?.traits?.gender),
        sexuality: String(t?.sexuality ?? '').trim(),
        sexualExperience: String(t?.sexualExperience ?? '').trim(),
    };
}

export function traitSummary(t) {
    const tr = t?.traits || {};
    return settings().traitKeys.map(k => tr[k]).filter(v => v && String(v).trim()).join(', ');
}
