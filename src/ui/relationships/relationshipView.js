// Relationship view: a popup showing the relationships around one person, as a Web (radial) or a Tree (grouped list).
// Opened from the relationship tab of the Library card (starting relationships) or the in-chat card (this chat's copy).
// Click a person to centre the view on them; Back returns; "Open card" opens the centred person's card.

import { getUserAvatar } from '../../../../../../personas.js';
import { ctx } from '../../core/context.js';
import { lib, save, settings } from '../../core/settings.js';
import { esc } from '../../core/utils.js';
import { attitudeColor, buildRelationshipGraph, groupTree, layoutWeb } from '../../logic/relationshipGraph.js';
import { USER_REF, relationshipDrift, relationshipTypeNames } from '../../logic/relationships.js';
import { personaKey } from '../../scene/persona.js';
import { currentScene } from '../../scene/roster.js';
import { avatarHtml } from '../avatar.js';
import { injectStyle } from '../injectStyle.js';
import { selectTemplate } from '../library/editor.js';
import { closePopovers } from '../popover.js';
import { openInstanceEditor } from '../roster/instanceEditor.js';

const VIEW_STYLE = `
.npcb-relview{display:flex;flex-direction:column;gap:8px;text-align:left}
.npcb-relview-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.npcb-relview-head .menu_button{width:auto;margin:0}
.npcb-relview-seg{display:flex;border:1px solid var(--SmartThemeBorderColor,#3a3d46);border-radius:6px;overflow:hidden}
.npcb-relview-seg .menu_button{border:0;border-radius:0;opacity:.65}
.npcb-relview-seg .menu_button.on{opacity:1;font-weight:600;background:var(--black30a,rgba(0,0,0,.3))}
.npcb-web{position:relative;width:100%;aspect-ratio:860/520;min-height:320px}
.npcb-web svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.npcb-web-node{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;max-width:130px;text-align:center}
.npcb-web-node .npcb-web-ava{border-radius:50%;padding:2px;border:2px solid var(--npcb-c,#8a8f9c)}
.npcb-web-node.inscene .npcb-web-ava{box-shadow:0 0 0 3px #90be6d}
.npcb-web-node.root .npcb-ava{width:64px;height:64px}
.npcb-web-node.second{opacity:.8}
.npcb-web-node b{font-size:.85em;line-height:1.1}
.npcb-web-node small{opacity:.7;font-size:.72em}
.npcb-web-label{position:absolute;transform:translate(-50%,-50%);display:flex;align-items:center;gap:4px;padding:1px 7px;border-radius:10px;font-size:.75em;white-space:nowrap;background:var(--SmartThemeBlurTintColor,#1f2126);border:1px solid var(--SmartThemeBorderColor,#3a3d46);pointer-events:none}
.npcb-web-label.second{opacity:.75;font-size:.7em}
.npcb-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex:0 0 auto}
.npcb-tree-group{font-size:.78em;text-transform:uppercase;letter-spacing:.05em;opacity:.7;margin:8px 0 2px}
.npcb-tree-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 6px;border-radius:8px;cursor:pointer}
.npcb-tree-row:hover{background:var(--black30a,rgba(0,0,0,.25))}
.npcb-tree-kids{margin-left:22px;padding-left:10px;border-left:1px solid var(--SmartThemeBorderColor,#3a3d46)}
.npcb-tree-chip{font-size:.78em;padding:1px 7px;border-radius:10px;border:1px solid var(--SmartThemeBorderColor,#3a3d46)}
.npcb-tree-att{display:inline-flex;align-items:center;gap:4px;font-size:.8em}
.npcb-tree-note{opacity:.7;font-size:.8em}
.npcb-relview-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:.78em;opacity:.85;border-top:1px solid var(--SmartThemeBorderColor,#3a3d46);padding-top:6px}
`;


/** Where people and their relationships come from: this chat (its instances) or the Library (templates). */
function makeSource(mode, root, rootRels) {
    const scene = mode === 'chat' ? currentScene() : null;
    const you = () => {
        const key = personaKey();
        return { name: mode === 'chat' ? (ctx().name1 || 'You') : 'You', card: key ? { portrait: getUserAvatar(key), color: '#8ecae6' } : { color: '#8ecae6' }, sub: 'you', inScene: mode === 'chat' };
    };
    const person = (id) => {
        if (id === USER_REF) return you();
        if (scene) {
            const i = scene.instances[id];
            if (i) return { name: i.name, card: i, inScene: scene.active.includes(id), sub: scene.active.includes(id) ? 'in scene' : 'not in scene' };
            const t = lib()[id];
            return { name: t?.name ?? id, card: t ?? null, inScene: false, sub: t ? 'not met in this chat' : 'unknown' };
        }
        const t = lib()[id];
        return { name: t?.name ?? id, card: t ?? null, inScene: false, sub: t?.folder || (t ? '' : 'not in the library') };
    };
    const relsOf = (id) => {
        if (id === root) return rootRels;
        if (id === USER_REF) return [];
        return (scene ? scene.instances[id]?.relationships : lib()[id]?.relationships) || [];
    };
    const canOpen = (id) => (id !== USER_REF && (scene ? scene.active.includes(id) : !!lib()[id]));
    return { scene, person, relsOf, canOpen };
}

/**
 * Open the view.
 *   root      the person in the centre (an NPC id)
 *   rootRels  their relationships right now (the editor's draft, so unsaved changes show)
 *   mode      'chat' (this chat's instances) or 'library' (templates)
 */
export async function openRelationshipView({ root, rootRels, mode = 'chat' }) {
    injectStyle('npcb_relview_style', VIEW_STYLE);
    const c = ctx();
    const s = settings();
    const src = makeSource(mode, root, rootRels);
    const st = { center: root, history: [], layout: s.relViewLayout === 'tree' ? 'tree' : 'web', depth: Number(s.relViewDepth) === 1 ? 1 : 2 };
    const box = $('<div class="npcb-relview"></div>');
    const attitudes = () => settings().attitudes || [];
    const color = (att) => attitudeColor(att, attitudes());
    const label = (r, mutual) => `${esc(r.type || '—')}${mutual ? ' ⇄' : ''} · ${esc(r.attitude || '—')}`;

    const webHtml = (g) => {
        const L = layoutWeb(g, { w: 860, h: 520 });
        const at = new Map(L.nodes.map(n => [n.id, n]));
        const pct = (n) => `left:${(n.x / L.w) * 100}%;top:${(n.y / L.h) * 100}%`;
        const lines = L.edges.map(e => {
            const a = at.get(e.from), b = at.get(e.to);
            return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color(e.rel.attitude)}" stroke-width="2" vector-effect="non-scaling-stroke"${e.level === 2 ? ' stroke-dasharray="6 5" opacity=".75"' : ''}></line>`;
        }).join('');
        const labels = L.edges.map(e => {
            const a = at.get(e.from), b = at.get(e.to);
            const t = e.level === 1 ? 0.55 : 0.5;
            const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            return `<div class="npcb-web-label ${e.level === 2 ? 'second' : ''}" style="${pct(m)}" title="${esc(e.rel.note || '')}"><span class="npcb-dot" style="background:${color(e.rel.attitude)}"></span>${label(e.rel, e.mutual)}</div>`;
        }).join('');
        const nodes = L.nodes.map(n => {
            const p = src.person(n.id);
            const cls = [n.level === 0 ? 'root' : '', n.level === 2 ? 'second' : '', p.inScene ? 'inscene' : ''].join(' ');
            return `<div class="npcb-web-node ${cls}" data-id="${esc(n.id)}" style="${pct(n)};--npcb-c:${esc(p.card?.color || '#8a8f9c')}" title="${esc(p.name)}">
                <div class="npcb-web-ava">${avatarHtml(p.card, p.name, n.level === 0 ? 'npcb-ava-md' : 'npcb-ava-sm')}</div><b>${esc(p.name)}</b>${p.sub ? `<small>${esc(p.sub)}</small>` : ''}</div>`;
        }).join('');
        return `<div class="npcb-web"><svg viewBox="0 0 ${L.w} ${L.h}" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${labels}${nodes}</div>`;
    };

    const treeHtml = (g) => {
        const isRoot = st.center === root && mode === 'chat';
        const row = (r, mutual, withDrift) => {
            const p = src.person(r.to);
            const drift = withDrift ? relationshipDrift(r) : '';
            const badge = drift === 'new' ? 'new in this chat' : drift === 'changed' ? 'changed' : '';
            return `<div class="npcb-tree-row" data-id="${esc(r.to)}">${avatarHtml(p.card, p.name, 'npcb-ava-sm')}<b>${esc(p.name)}</b>
                <span class="npcb-tree-chip">${esc(r.type || '—')}</span>
                <span class="npcb-tree-att"><span class="npcb-dot" style="background:${color(r.attitude)}"></span>${esc(r.attitude || '—')}</span>
                ${mutual ? '<span title="Both directions">⇄</span>' : ''}
                ${p.sub ? `<small class="npcb-dim">${esc(p.sub)}</small>` : ''}
                ${badge ? `<span class="npcb-rel-badge">${esc(badge)}</span>` : ''}
                ${r.note ? `<span class="npcb-tree-note">${esc(r.note)}</span>` : ''}</div>`;
        };
        const groups = groupTree(g, relationshipTypeNames(settings().relationshipTypes));
        if (!groups.length) return '<div class="npcb-empty">No relationships yet.</div>';
        return groups.map(gr => `<div class="npcb-tree-group">${esc(gr.type || 'No type')} · ${gr.items.length}</div>${gr.items.map(it => `${row(it.rel, it.mutual, isRoot)}${it.children.length ? `<div class="npcb-tree-kids">${it.children.map(k => row(k, false, false)).join('')}</div>` : ''}`).join('')}`).join('');
    };

    const draw = () => {
        const g = buildRelationshipGraph(st.center, src.relsOf(st.center), { relsOf: src.relsOf, depth: st.depth });
        const me = src.person(st.center);
        const seg = (act, items) => `<div class="npcb-relview-seg">${items.map(([v, t, on]) => `<div class="menu_button ${on ? 'on' : ''}" data-act="${act}" data-v="${v}">${t}</div>`).join('')}</div>`;
        box.html(`<div class="npcb-relview-head">
                ${st.history.length ? '<div class="menu_button" data-act="back" title="Back"><i class="fa-solid fa-arrow-left"></i></div>' : ''}
                ${avatarHtml(me.card, me.name, 'npcb-ava-sm')}<b>${esc(me.name)}'s relationships</b>
                <small class="npcb-dim">${mode === 'chat' ? 'this chat' : 'starting relationships'}</small>
                <span class="npcb-spacer" style="flex:1"></span>
                ${st.center !== root && src.canOpen(st.center) ? '<div class="menu_button" data-act="open" title="Open this card"><i class="fa-solid fa-id-card"></i> Open card</div>' : ''}
                ${seg('depth', [[1, 'Direct', st.depth === 1], [2, '+ their links', st.depth === 2]])}
                ${seg('layout', [['web', '<i class="fa-solid fa-circle-nodes"></i> Web', st.layout === 'web'], ['tree', '<i class="fa-solid fa-sitemap"></i> Tree', st.layout === 'tree']])}
            </div>
            ${g.edges.length ? (st.layout === 'web' ? webHtml(g) : treeHtml(g)) : '<div class="npcb-empty">No relationships yet.</div>'}
            <div class="npcb-relview-legend"><span>Attitude:</span>${attitudes().map(a => `<span><span class="npcb-dot" style="background:${color(a)}"></span> ${esc(a)}</span>`).join('')}
                <span style="flex:1"></span><span>${st.layout === 'web' ? 'Solid: own · dashed: their links · green ring: in scene · ' : ''}Click someone to centre on them</span></div>`);
    };

    let afterClose = null;
    const popup = new c.Popup(box, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: 'Close' });
    box.on('click', '[data-act="depth"]', (e) => { st.depth = Number($(e.currentTarget).data('v')); s.relViewDepth = st.depth; save(); draw(); });
    box.on('click', '[data-act="layout"]', (e) => { st.layout = String($(e.currentTarget).data('v')); s.relViewLayout = st.layout; save(); draw(); });
    box.on('click', '[data-act="back"]', () => { st.center = st.history.pop() ?? root; draw(); });
    box.on('click', '.npcb-web-node, .npcb-tree-row', (e) => {
        const id = String($(e.currentTarget).data('id'));
        if (!id || id === st.center || id === USER_REF) return; // you have no relationship list of your own
        st.history.push(st.center);
        st.center = id;
        draw();
    });
    box.on('click', '[data-act="open"]', () => {
        const id = st.center;
        afterClose = () => {
            if (mode === 'library') { selectTemplate(id); return; }
            closePopovers();
            const card = $('#npcb_roster .npcb-roster-cards .npcb-card').filter((_, el) => String($(el).data('id')) === id)[0];
            if (card) openInstanceEditor(id, card);
        };
        popup.complete(c.POPUP_RESULT.AFFIRMATIVE);
    });
    draw();
    await popup.show();
    afterClose?.();
}
