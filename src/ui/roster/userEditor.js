// Popover editor for the persona's live posture and outfit.

import { getUserAvatar } from '../../../../../../personas.js';
import { ctx } from '../../core/context.js';
import { outfitCatalog } from '../../core/extHooks.js';
import { extensions } from '../../core/runtime.js';
import { settings } from '../../core/settings.js';
import { clone, esc } from '../../core/utils.js';
import { resolveOutfit } from '../../logic/outfit.js';
import { currentUser, personaData, personaKey, setUserInScene } from '../../scene/persona.js';
import { writeCurrentScene } from '../../scene/roster.js';
import { avatarHtml } from '../avatar.js';
import { openPersonaCharacter } from '../persona/personaCharacter.js';
import { closePopovers, placePopover } from '../popover.js';
import { mountPaperdoll } from '../wardrobe/paperdoll.js';
import { bindTabs } from '../tabs.js';
import { sheetSaved } from '../../core/extHooks.js';
import { save } from '../../core/settings.js';
import { renderRoster } from './rosterBar.js';
import { draftOf, renderSceneTabs, sceneTabByKey, sceneTabExtensions, sceneTabsHtml } from './sceneTabs.js';

export function openUserEditor(anchor) {
    closePopovers();
    const c = ctx();
    const s = settings();
    const u = clone(currentUser());
    const opts = (list, cur) => {
        const all = [...list];
        if (cur && !all.includes(cur)) all.unshift(cur);
        return all.map(x => `<option value="${esc(x)}" ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
    };
    const ava = personaKey() ? `<img class="npcb-ava npcb-ava-md" src="${esc(getUserAvatar(personaKey()))}">` : avatarHtml(null, c.name1, 'npcb-ava-md');
    // Extra tabs (sceneTabs, API 14): your persona data of each extension, saved with Save
    const sceneExt = sceneTabExtensions('user');
    const drafts = {};
    for (const { x } of sceneExt) drafts[x.id] = draftOf(x, personaData().ext?.[x.id]);
    const st = sceneTabsHtml(sceneExt);
    const tabbed = sceneExt.length > 0;
    const pop = $(`<div class="npcb-popover npcb-inst">
        <div class="npcb-inst-head"><div class="npcb-u-ava">${ava}</div><div><b>${esc(c.name1)}</b><br><small class="npcb-dim npcb-u-where"></small></div></div>
        ${tabbed ? `<div class="npcb-tabs"><div class="npcb-tab active" data-tab="state">State</div>${st.heads}</div>` : ''}
        <div class="npcb-tabpane" data-pane="state">
        <div class="menu_button npcb-u-scene" style="width:auto; white-space:nowrap;"></div>
        <label>Current posture<select class="text_pole npcb-u-posture">${opts(s.postures, u.posture)}</select></label>
        <div class="npcb-doll-host"></div>
        </div>
        ${st.panes}
        <div class="npcb-row"><div class="menu_button npcb-u-save"><i class="fa-solid fa-check"></i> Save</div>
        ${[...extensions.values()].filter(x => x.personaSheet).map(x => `<div class="menu_button npcb-u-ext" data-ext="${esc(x.id)}"><i class="fa-solid ${esc(x.personaSheet.icon || 'fa-table-list')}"></i> ${esc(x.personaSheet.label || x.id)}</div>`).join('')}</div>
    </div>`);
    pop.on('click', '.npcb-u-ext', (e) => { const id = $(e.currentTarget).data('ext'); closePopovers(); openPersonaCharacter(`ext:${id}`); });
    pop.on('click', e => e.stopPropagation());
    const showWhere = () => {
        const inScene = !u.absent;
        pop.find('.npcb-u-where').text(`you · persona · ${inScene ? 'in-scene' : 'not-in-scene'}`);
        pop.find('.npcb-u-ava').attr('style', inScene ? '' : 'opacity:.35 !important; filter:grayscale(1) !important;');
        pop.find('.npcb-u-scene').html(inScene
            ? '<i class="fa-solid fa-door-open"></i> Leave the scene'
            : '<i class="fa-solid fa-right-to-bracket"></i> Place yourself in the scene');
    };
    showWhere();
    // Takes effect at once (no Save needed); posture and outfit edits in this popover still wait for Save.
    pop.on('click', '.npcb-u-scene', () => {
        u.absent = !u.absent;
        writeCurrentScene(null, setUserInScene(!u.absent));
        showWhere();
    });
    let draft = resolveOutfit(u.outfit);
    mountPaperdoll(pop.find('.npcb-doll-host'), () => draft, (o) => { draft = o; }, () => {
        const p = personaData();
        const cat = outfitCatalog({ source: 'editor', kind: 'user', id: 'user', subject: p, ext: { ...(p.ext || {}), ...(u.ext || {}) } });
        return { ...cat, actions: cat.actions.map(a => ({ ...a, run: () => { closePopovers(); if (a.run) a.run({ kind: 'user', id: 'user', scope: 'persona' }); else openPersonaCharacter(`ext:${a.extId}`); } })) };
    });
    if (tabbed) {
        bindTabs(pop);
        renderSceneTabs(pop, sceneExt, drafts, () => ({ kind: 'user', id: 'user', name: c.name1, scope: 'persona', subject: personaData() }));
        pop.on('click', '.npcb-tab', (e) => {
            const wide = !!sceneTabByKey(String($(e.currentTarget).data('tab')))?.wide;
            pop.toggleClass('npcb-inst-wide', wide).css('width', wide ? 'min(760px, 96vw)' : '');
            placePopover(pop, anchor);
        });
    }
    pop.on('click', '.npcb-u-save', () => {
        writeCurrentScene(null, { ...u, posture: String(pop.find('.npcb-u-posture').val() ?? ''), outfit: draft, dressed: true });
        if (sceneExt.length) {
            // scene tabs edit your persona data (as the persona sheet does)
            const p = personaData();
            p.ext = { ...(p.ext || {}), ...clone(drafts) };
            save();
            renderRoster();
            for (const { x } of sceneExt) sheetSaved(x, 'personaSheet', { id: 'user', scope: 'persona', data: drafts[x.id] });
        }
        closePopovers();
    });
    placePopover(pop, anchor);
}
