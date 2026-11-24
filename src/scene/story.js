// Recent chat text for LLM side prompts (portraits, assist).

import { ctx } from '../core/context.js';

export function recentStory(n = 4, max = 2500) {
    const chat = ctx().chat || [];
    const out = [];
    for (let i = chat.length - 1; i >= 0 && out.length < n; i--) {
        const m = chat[i];
        if (!m || m.is_system) continue;
        out.unshift(`${m.name}: ${String(m.mes || '').replace(/<[^>]+>/g, '')}`);
    }
    const txt = out.join('\n\n');
    return txt.length > max ? txt.slice(txt.length - max) : txt;
}
