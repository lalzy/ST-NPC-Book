// "In scene" bar above the input box.

import { getUserAvatar } from '../../../../../../personas.js';
import { HEX_RE } from '../../constants.js';
import { ctx, hasChat } from '../../core/context.js';
import { chatNewNpcFolder, newNpcFolder } from '../../core/folders.js';
import { extensions } from '../../core/runtime.js';
import { save, settings } from '../../core/settings.js';
import { esc } from '../../core/utils.js';
import { ensurePortrait } from '../../portraits/portraitQueue.js';
import { updateAutoInjection } from '../../prompt/injection.js';
import { currentUser, personaKey, setUserInScene, userInScene } from '../../scene/persona.js';
import { currentRoster, writeCurrentScene } from '../../scene/roster.js';
import { avatarHtml } from '../avatar.js';
import { showTrackerBlock } from '../trackerBlock.js';
import { openAddPicker } from './addPicker.js';
import { openInstanceEditor } from './instanceEditor.js';
import { openNewNpcFolderMenu } from './newNpcFolderMenu.js';
import { openUserEditor } from './userEditor.js';

export function ensureRosterBar() {
    if ($('#npcb_roster').length) return;
    const bar = $(`
        <div id="npcb_roster" class="npcb-roster">
            <div class="npcb-roster-head">
                <span class="npcb-roster-toggle fa-solid fa-chevron-down" title="Collapse / expand"></span>
                <span class="npcb-roster-title">In scene</span>
                <span class="npcb-roster-count"></span>
                <span class="npcb-roster-add fa-solid fa-user-plus" title="Add NPC to scene"></span>
                <span class="npcb-roster-folder fa-solid fa-folder" title="Folder for new NPCs"></span>
                <span class="npcb-roster-ext"></span>
                <span class="npcb-roster-block fa-solid fa-code" title="Show the last NPC block the AI wrote"></span>
            </div>
            <div class="npcb-roster-body"><div class="npcb-user-slot"></div><div class="npcb-roster-cards"></div></div>
        </div>`);
    $('#send_form').before(bar);
    bar.on('click', '.npcb-roster-toggle', () => { settings().rosterCollapsed = !settings().rosterCollapsed; save(); renderRoster(); });
    bar.on('click', '.npcb-roster-add', (e) => { e.stopPropagation(); openAddPicker(e.currentTarget); });
    bar.on('click', '.npcb-roster-folder', (e) => { e.stopPropagation(); openNewNpcFolderMenu(e.currentTarget); });
    bar.on('click', '.npcb-roster-extbtn', (e) => {
        e.stopPropagation();
        const ext = extensions.get(String($(e.currentTarget).data('ext')));
        try { ext?.sceneButton?.onClick?.(e.currentTarget); } catch (err) { console.warn(`[NPC Book] ${ext?.id} scene button failed`, err); }
    });
    bar.on('click', '.npcb-roster-block', (e) => { e.stopPropagation(); showTrackerBlock(); });
    bar.on('click', '.npcb-roster-cards .npcb-card', (e) => { e.stopPropagation(); openInstanceEditor($(e.currentTarget).data('id'), e.currentTarget); });
    bar.on('click', '.npcb-user-scene', (e) => { e.stopPropagation(); writeCurrentScene(null, setUserInScene(!userInScene())); });
    bar.on('click', '.npcb-user-card', (e) => { e.stopPropagation(); openUserEditor(e.currentTarget); });
}

export function renderRoster() {
    ensureRosterBar();
    const s = settings();
    const bar = $('#npcb_roster');
    if (!s.enabled || !hasChat()) { bar.hide(); updateAutoInjection(); return; }
    // Collapsed = one thin line: "In scene (n)" and the add button. Everything else (persona card included) hides.
    const collapsed = !!s.rosterCollapsed;
    bar.show().toggleClass('npcb-collapsed', collapsed);
    bar.find('.npcb-roster-body').toggle(!collapsed);
    bar.find('.npcb-roster-toggle').toggleClass('fa-chevron-down', !collapsed).toggleClass('fa-chevron-right', collapsed).attr('title', collapsed ? 'Expand' : 'Collapse');
    bar.find('.npcb-roster-folder').toggle(!collapsed);
    renderExtButtons(bar.find('.npcb-roster-ext').toggle(!collapsed));
    bar.find('.npcb-roster-block').toggle(!!s.debug && !collapsed); // debug tool: last <npcs> block
    const chatFolder = chatNewNpcFolder();
    const where = newNpcFolder() || 'top level';
    bar.find('.npcb-roster-folder')
        .toggleClass('fa-folder', chatFolder === undefined).toggleClass('fa-folder-open', chatFolder !== undefined)
        .attr('title', `New NPCs go to: ${where}${chatFolder !== undefined ? ' (this chat)' : ' (default from Settings)'}. Click to change.`);
    const roster = currentRoster();
    bar.find('.npcb-roster-count').text(roster.length ? `(${roster.length})` : '');
    const cardHtml = (inst) => {
        const t = inst; // the chat's instance carries its own card fields
        if (!t.portrait) ensurePortrait(t.id, { target: 'instance' });
        const name = t?.name ?? inst.name ?? inst.id;
        const sub = [inst.posture, inst.state].filter(Boolean).join(' · ');
        return `<div class="npcb-card" data-id="${esc(inst.id)}" title="${esc(name)}${inst.feelings ? `\n💭 ${esc(inst.feelings)}` : ''}">
            ${avatarHtml(t, name)}
            <div class="npcb-card-name" ${HEX_RE.test(t?.color || '') ? `style="color:${t.color}"` : ''}>${esc(name)}</div>
            <div class="npcb-card-sub">${esc(sub)}</div>
        </div>`;
    };
    // Friendly characters on the left, enemies on the right (only split when someone in the scene is an enemy).
    const enemies = roster.filter(isEnemy);
    const friends = roster.filter(i => !enemies.includes(i));
    let html;
    if (!roster.length) html = '<div class="npcb-empty">Nobody here. Add an NPC, or the LLM will add them as they appear.</div>';
    else if (!enemies.length) html = friends.map(cardHtml).join('');
    else {
        html = `<div class="npcb-roster-side npcb-side-friendly" title="Friendly / neutral">${friends.length ? friends.map(cardHtml).join('') : '<div class="npcb-empty">No friendlies.</div>'}</div>
            <div class="npcb-roster-divider" title="Friendly | Enemies"><span><i class="fa-solid fa-user-shield"></i></span><span class="npcb-roster-divline"></span><span><i class="fa-solid fa-skull"></i></span></div>
            <div class="npcb-roster-side npcb-side-enemy" title="Enemies">${enemies.map(cardHtml).join('')}</div>`;
    }
    bar.find('.npcb-roster-cards').toggleClass('npcb-roster-split', enemies.length > 0).html(html);
    const us = bar.find('.npcb-user-slot');
    if (s.trackUser) {
        const c = ctx();
        const u = currentUser();
        const inScene = userInScene(u);
        const ava = personaKey() ? `<img class="npcb-ava" src="${esc(getUserAvatar(personaKey()))}" draggable="false">` : avatarHtml(null, c.name1);
        // Out of the scene: faded avatar and "not in scene". Inline styles so SillyTavern's own CSS can't override them.
        const fade = inScene ? '' : ' style="opacity:.35 !important; filter:grayscale(1) !important;"';
        const sub = inScene ? esc(u.posture || '') : '<i>not in scene</i>';
        const btn = `<div class="npcb-user-scene fa-solid ${inScene ? 'fa-door-open' : 'fa-right-to-bracket'}" title="${inScene ? 'Leave the scene' : 'Place yourself in the scene'}" style="position:absolute; top:0; right:0; font-size:.75em; padding:3px; border-radius:6px; background:var(--SmartThemeBlurTintColor, #222); cursor:pointer; opacity:.85;"></div>`;
        us.show().html(`<div class="npcb-card npcb-user-card${inScene ? '' : ' npcb-user-out'}" style="position:relative;" title="${esc(c.name1)} (you · persona · ${inScene ? 'in-scene' : 'not-in-scene'})"><div class="npcb-user-ava"${fade}>${ava}</div><div class="npcb-card-name"${inScene ? '' : ' style="opacity:.6"'}>${esc(c.name1)}</div><div class="npcb-card-sub">${sub}</div>${btn}</div>`);
    } else us.hide().empty();
    updateAutoInjection();
}

/**
 * Is a scene character an enemy? A sister extension says so with sceneSide(instance) → 'enemy' | 'friendly'
 * (e.g. a Bestiary); without an answer, an instance copied from a card marked "enemy": true counts as one.
 */
export function isEnemy(inst) {
    for (const ext of extensions.values()) {
        if (typeof ext?.sceneSide !== 'function') continue;
        try {
            const side = ext.sceneSide(inst);
            if (side === 'enemy') return true;
            if (side === 'friendly') return false;
        } catch (e) { console.warn(`[NPC Book] ${ext.id} sceneSide failed`, e); }
    }
    return inst?.enemy === true || inst?.kind === 'enemy';
}

/** Scene bar buttons added by sister extensions (registerExtension({ sceneButton })). */
function renderExtButtons(host) {
    const out = [];
    for (const ext of extensions.values()) {
        const b = ext.sceneButton;
        if (!b || typeof b.onClick !== 'function') continue;
        try {
            const icon = String((typeof b.icon === 'function' ? b.icon() : b.icon) || 'fa-puzzle-piece');
            const title = String((typeof b.title === 'function' ? b.title() : b.title) || ext.label || ext.id);
            const off = typeof b.active === 'function' && b.active() === false;
            out.push(`<span class="npcb-roster-extbtn fa-solid ${esc(icon)}${off ? ' npcb-ext-off' : ''}" data-ext="${esc(ext.id)}" title="${esc(title)}"></span>`);
        } catch (e) { console.warn(`[NPC Book] ${ext.id} scene button failed`, e); }
    }
    host.html(out.join(''));
}
