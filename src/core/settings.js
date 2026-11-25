// Extension settings: load (missing keys get defaults), save, and the NPC library stored in them.

import { DEFAULTS, MODULE } from '../constants.js';
import { ctx } from './context.js';

export function settings() {
    const es = ctx().extensionSettings;
    if (!es[MODULE]) es[MODULE] = structuredClone(DEFAULTS);
    const s = es[MODULE];
    // the user's values always win: only keys that are missing get a default, nothing saved is rewritten
    for (const [k, v] of Object.entries(DEFAULTS)) if (s[k] === undefined) s[k] = structuredClone(v);
    return s;
}
export const save = () => ctx().saveSettingsDebounced();
export const lib = () => settings().library;
