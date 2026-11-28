// Extra tabs sister extensions add to the scene cards (API 14): registerExtension({ sceneTabs: [...] }).
// A scene card is the popover a character in the scene bar opens: an NPC's (instance) or your own (persona).
// Each tab edits a draft of its extension's data for that character; the card's Save stores it.

import { extensions } from '../../core/runtime.js';
import { clone, esc } from '../../core/utils.js';

/** One extension's scene tabs for this kind of card ('char' | 'user'), normalized. */
export function sceneTabsOf(x, kind) {
    const list = Array.isArray(x?.sceneTabs) ? x.sceneTabs : x?.sceneTabs ? [x.sceneTabs] : [];
    return list.filter(t => t && typeof t.render === 'function')
        .map((t, i) => ({ ...t, key: `scene:${x.id}:${String(t.id || i)}`, kinds: Array.isArray(t.kinds) && t.kinds.length ? t.kinds : ['char', 'user'] }))
        .filter(t => t.kinds.includes(kind));
}

/** Every registered extension that has a scene tab for this kind of card, with its tabs. */
export const sceneTabExtensions = (kind) => [...extensions.values()].map(x => ({ x, tabs: sceneTabsOf(x, kind) })).filter(e => e.tabs.length);

/** Tab headers and panes for these extensions' scene tabs. */
export function sceneTabsHtml(list) {
    const tabs = list.flatMap(e => e.tabs);
    return {
        heads: tabs.map(t => `<div class="npcb-tab" data-tab="${esc(t.key)}">${t.icon ? `<i class="fa-solid ${esc(t.icon)}"></i> ` : ''}${esc(t.label || t.id || 'Tab')}</div>`).join(''),
        panes: tabs.map(t => `<div class="npcb-tabpane" data-pane="${esc(t.key)}" style="display:none"><div class="npcb-ext-host" data-scene-tab="${esc(t.key)}"></div></div>`).join(''),
    };
}

/** Draw every scene tab into its pane. drafts: { [extId]: data } shared with the extension's other tabs on this card. */
export function renderSceneTabs(pop, list, drafts, ctxOf) {
    for (const { x, tabs } of list) {
        for (const t of tabs) {
            const host = pop.find(`.npcb-ext-host[data-scene-tab="${t.key}"]`);
            try { t.render(host, { ...ctxOf(x), data: drafts[x.id], tab: t.id }); } catch (e) { console.error(`[NPC Book] ${x.id} scene tab ${t.id} failed`, e); host.text(`Error: ${e.message}`); }
        }
    }
}

/** A scene tab by its key ('scene:<ext>:<tab>'), for the wide option. */
export function sceneTabByKey(key) {
    const m = /^scene:([^:]+):(.+)$/.exec(String(key));
    if (!m) return null;
    const x = extensions.get(m[1]);
    return x ? sceneTabsOf(x, 'char').concat(sceneTabsOf(x, 'user')).find(t => t.key === key) || null : null;
}

/** A draft of an extension's data: the stored data, else its defaultData(). */
export const draftOf = (x, stored) => clone(stored ?? (typeof x.defaultData === 'function' ? x.defaultData() : {}));
