// NPC card editor in the Library window: render, bind and save.

import { HEX_RE } from '../../constants.js';
import { ctx, hasChat } from '../../core/context.js';
import { allFolders, normFolder, registerFolder } from '../../core/folders.js';
import { pickColor } from '../../core/npcs.js';
import { outfitCatalog, sheetSaved } from '../../core/extHooks.js';
import { extensions } from '../../core/runtime.js';
import { lib, save, settings } from '../../core/settings.js';
import { clone, esc } from '../../core/utils.js';
import { cropImageUrl, readFileAsDataUrl, uploadPortrait } from '../../images/imageTools.js';
import { startingOutfit } from '../../logic/outfit.js';
import { defaultPronouns } from '../../logic/profile.js';
import { ID_PATTERN, uniqueId } from '../../logic/text.js';
import { ensurePortrait } from '../../portraits/portraitQueue.js';
import { addToScene, currentRoster, removeFromScene } from '../../scene/roster.js';
import { renderAssist } from '../assist/assistPanel.js';
import { resetAssistFor } from '../assist/assistState.js';
import { avatarHtml } from '../avatar.js';
import { renderRoster } from '../roster/rosterBar.js';
import { bindTabs } from '../tabs.js';
import { mountPaperdoll } from '../wardrobe/paperdoll.js';
import { mountDialogueExamples } from './dialogueExamples.js';
import { exportNpcs } from './importExport.js';
import { renderLibraryList } from './libraryList.js';
import { openLibrary } from './modal.js';
import { openPortraitMenu, openServerImagePicker } from './portraitPicker.js';
import { libState } from './state.js';

export function selectTemplate(id, isNew = false, tab = 'card') {
    // Tabs that moved to sister extensions (older links / remembered tabs).
    if (tab === 'wardrobe' || tab === 'relationships') tab = extensions.get(tab)?.cardTab ? `ext:${tab}` : (tab === 'wardrobe' ? 'outfit' : 'card');
    resetAssistFor(isNew ? '__new__' : id);
    libState.isNew = isNew;
    libState.selected = isNew ? null : id;
    libState.draftPortrait = null;
    libState.draftOutfit = [];
    renderLibraryList();
    const ed = $('#npcb_library .npcb-lib-editor');
    const t = isNew ? { id: '', name: '', portrait: '', description: '', details: '', traits: {}, color: pickColor(), folder: libState.newFolder } : lib()[id];
    if (!t) { ed.html('<div class="npcb-empty">Select or create an NPC.</div>'); return; }
    const s = settings();
    const traitKeys = [...new Set([...s.traitKeys, ...Object.keys(t.traits || {})])];
    const present = hasChat() && !isNew && currentRoster().some(i => i.id === t.id);
    libState.draftOutfit = startingOutfit(t, s.conditions);
    libState.draftExt = clone(t.ext || {});
    libState.draftDialogue = clone(t.dialogue || []);
    const extTabs = [...extensions.values()].filter(x => x.cardTab);
    ed.html(`
      <div class="npcb-tabs"><div class="npcb-tab ${tab === 'card' ? 'active' : ''}" data-tab="card">Card</div><div class="npcb-tab ${tab === 'outfit' ? 'active' : ''}" data-tab="outfit">Outfit</div>${extTabs.map(x => `<div class="npcb-tab ${tab === `ext:${x.id}` ? 'active' : ''}" data-tab="ext:${esc(x.id)}">${esc(x.cardTab.label || x.id)}</div>`).join('')}</div>
      <div class="npcb-tabpane" data-pane="card" ${tab === 'card' ? '' : 'style="display:none"'}>
      <div class="npcb-ed-top">
        <div class="npcb-ed-portrait" title="Click to set portrait">${avatarHtml(t, t.name || '?', 'npcb-ava-lg')}</div>
        <input type="file" class="npcb-ed-file" accept="image/*" hidden>
        <div class="npcb-ed-ident">
          <label>ID ${isNew ? '<small class="npcb-dim">(unique, cannot be changed later)</small>' : '<small class="npcb-dim">(locked)</small>'}
            <input class="text_pole npcb-ed-id" value="${esc(t.id)}" ${isNew ? '' : 'disabled'} placeholder="auto from name"></label>
          <label>Name<input class="text_pole npcb-ed-name" value="${esc(t.name)}" placeholder="Display name"></label>
          <label>Folder<input class="text_pole npcb-ed-folder" list="npcb_folder_list" value="${esc(t.folder || '')}" placeholder="none (top level) — use / for subfolders"></label>
          <datalist id="npcb_folder_list">${allFolders().map(f => `<option value="${esc(f)}"></option>`).join('')}</datalist>
          <label>Dialogue color <small class="npcb-dim">(their dialogue in speaker cards, and their name in the scene bar)</small>
            <div class="npcb-row npcb-color-row">
              <input type="color" class="npcb-ed-color" value="${HEX_RE.test(t.color || '') ? t.color : '#ffffff'}">
              <input class="text_pole npcb-ed-colorhex" value="${esc(t.color || '')}" placeholder="#RRGGBB (empty = none)">
              <span class="npcb-color-preview" style="color:${HEX_RE.test(t.color || '') ? t.color : 'inherit'}">"Sample line."</span>
            </div></label>
          <div class="npcb-row npcb-ed-portrait-btns">
            <div class="menu_button npcb-ed-setimg"><i class="fa-solid fa-image"></i> Portrait</div>
            <div class="menu_button npcb-ed-cropimg" title="Crop portrait"><i class="fa-solid fa-crop-simple"></i> Crop</div>
            <div class="menu_button npcb-ed-clrimg"><i class="fa-solid fa-trash-can"></i></div>
            ${isNew ? '' : '<div class="menu_button npcb-ed-genimg" title="Generate with the Image Generation extension"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</div>'}
          </div>
        </div>
      </div>
      <label>Description <small class="npcb-dim">(only you see this — never sent to the LLM)</small>
        <textarea class="text_pole npcb-ed-desc" rows="3">${esc(t.description)}</textarea></label>
      <label>Details <small class="npcb-dim">(sent to the LLM while this NPC is in the scene)</small>
        <textarea class="text_pole npcb-ed-details" rows="10">${esc(t.details)}</textarea></label>
      <div class="npcb-dx-wrap">
        <div><b>Dialogue examples</b> <small class="npcb-dim">(sent to the LLM; mood examples only while this NPC is in that mood)</small></div>
        <div class="npcb-dx-host"></div>
      </div>
      <div class="npcb-ed-traits">
        <div><b>Identity</b> <small class="npcb-dim">(used to tell same-name characters apart; empty fields fall back to searching the Details text)</small></div>
        ${traitKeys.map(k => `<label>${esc(k)}<input class="text_pole npcb-ed-trait" data-key="${esc(k)}" value="${esc(t.traits?.[k] ?? '')}"></label>`).join('')}
      </div>
      <div class="npcb-ed-traits npcb-ed-profile">
        <div><b>Profile</b> <small class="npcb-dim">(sent to the LLM; not used for matching)</small></div>
        <label>Height<input class="text_pole npcb-ed-height" value="${esc(t.height ?? '')}" placeholder="e.g. 170 cm, tall"></label>
        <label>Pronouns<input class="text_pole npcb-ed-pronouns" value="${esc(String(t.pronouns ?? '').trim() || defaultPronouns(t.traits?.gender))}" data-auto="${String(t.pronouns ?? '').trim() ? '0' : '1'}" placeholder="he/him, she/her, they/them"></label>
        <label>Sexuality<input class="text_pole npcb-ed-sexuality" value="${esc(t.sexuality ?? '')}" placeholder="e.g. heterosexual, bisexual, gay, asexual"></label>
        <label>Sexual experience<input class="text_pole npcb-ed-sexexp" value="${esc(t.sexualExperience ?? '')}" placeholder="e.g. virgin, experienced"></label>
      </div>
      </div>
      <div class="npcb-tabpane" data-pane="outfit" ${tab === 'outfit' ? '' : 'style="display:none"'}>
        <small class="npcb-dim">What ${esc(t.name || 'this NPC')} wears when a chat first meets them. Click a slot to dress it.</small>
        <div class="npcb-doll-host"></div>
      </div>
      ${extTabs.map(x => `<div class="npcb-tabpane" data-pane="ext:${esc(x.id)}" ${tab === `ext:${x.id}` ? '' : 'style="display:none"'}><div class="npcb-ext-host" data-ext="${esc(x.id)}"></div></div>`).join('')}
      <div class="npcb-row npcb-ed-actions">
        <div class="menu_button npcb-ed-save"><i class="fa-solid fa-floppy-disk"></i> Save</div>
        ${isNew ? '' : `<div class="menu_button npcb-ed-scene">${present ? '<i class="fa-solid fa-user-minus"></i> Remove from scene' : '<i class="fa-solid fa-user-plus"></i> Add to scene'}</div>`}
        ${isNew ? '' : '<div class="menu_button npcb-ed-dup"><i class="fa-solid fa-clone"></i> Duplicate</div>'}
        ${isNew ? '' : '<div class="menu_button npcb-ed-export" title="Export this NPC (saved version) as JSON"><i class="fa-solid fa-file-export"></i> Export</div>'}
        <div class="menu_button npcb-ed-assist" title="LLM assist for the card"><i class="fa-solid fa-wand-magic-sparkles"></i> Assist</div>
        <span class="npcb-spacer"></span>
        ${isNew ? '' : '<div class="menu_button redWarningBG npcb-ed-del"><i class="fa-solid fa-trash"></i> Delete</div>'}
      </div>`);

    ed.off('.npcb');
    bindTabs(ed);
    mountDialogueExamples(ed.find('.npcb-dx-host'), libState.draftDialogue);
    ed.on('click.npcb', '.npcb-tab', () => renderAssist());
    ed.on('click.npcb', '.npcb-ed-export', () => exportNpcs([lib()[t.id]].filter(Boolean), `${t.id}.npcbook.json`));
    // Starting outfit: any clothing, or items a sister extension offers (e.g. a wardrobe, read from its unsaved tab).
    const showTab = (tb) => ed.find(`.npcb-tab[data-tab="${tb}"]`).trigger('click');
    libState.dollUi = mountPaperdoll(ed.find('.npcb-doll-host'), () => libState.draftOutfit, (o) => { libState.draftOutfit = o; }, () => {
        const cat = outfitCatalog({ source: 'editor', kind: 'char', id: t.id, subject: t, ext: libState.draftExt });
        return { ...cat, actions: cat.actions.map(a => ({ ...a, run: () => (a.run ? a.run({ kind: 'char', id: t.id, scope: 'template' }) : showTab(`ext:${a.extId}`)) })) };
    });
    ed.on('click.npcb', '.npcb-tab[data-tab="outfit"]', () => libState.dollUi?.refresh());
    const showDraft = () => {
        const cur = libState.draftPortrait === null ? (lib()[t.id]?.portrait || '') : libState.draftPortrait;
        ed.find('.npcb-ed-portrait').html(cur ? `<img class="npcb-ava npcb-ava-lg" src="${esc(cur)}">` : avatarHtml(null, ed.find('.npcb-ed-name').val() || '?', 'npcb-ava-lg'));
    };
    const usePicked = async (url) => {
        if (!url) return;
        const cropped = await cropImageUrl(url, true);
        libState.draftPortrait = cropped || url;
        showDraft();
    };
    ed.on('click.npcb', '.npcb-ed-portrait, .npcb-ed-setimg', (e) => {
        e.stopPropagation();
        openPortraitMenu(e.currentTarget, {
            local: () => ed.find('.npcb-ed-file').trigger('click'),
            server: async () => usePicked(await openServerImagePicker()),
            crop: async () => {
                const cur = libState.draftPortrait === null ? (lib()[t.id]?.portrait || '') : libState.draftPortrait;
                if (!cur) { toastr.info('No portrait to crop yet.', 'NPC Book'); return; }
                const cropped = await cropImageUrl(cur, false);
                if (cropped) { libState.draftPortrait = cropped; showDraft(); }
            },
            generate: isNew ? null : () => { toastr.info(`Generating a portrait for ${t.name}…`, 'NPC Book'); ensurePortrait(t.id, { force: true }); },
            remove: () => { libState.draftPortrait = ''; showDraft(); },
        });
    });
    ed.on('click.npcb', '.npcb-ed-cropimg', async () => {
        const cur = libState.draftPortrait === null ? (lib()[t.id]?.portrait || '') : libState.draftPortrait;
        if (!cur) { toastr.info('No portrait to crop yet.', 'NPC Book'); return; }
        const cropped = await cropImageUrl(cur, false);
        if (cropped) { libState.draftPortrait = cropped; showDraft(); }
    });
    ed.on('change.npcb', '.npcb-ed-file', async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try { await usePicked(await readFileAsDataUrl(file)); } catch (err) { toastr.error('Could not read image.', 'NPC Book'); }
    });
    for (const x of extTabs) {
        const host = ed.find(`.npcb-ext-host[data-ext="${x.id}"]`);
        if (!libState.draftExt[x.id]) libState.draftExt[x.id] = typeof x.defaultData === 'function' ? x.defaultData() : {};
        try { x.cardTab.render(host, { data: libState.draftExt[x.id], template: t, isNew, kind: 'char', id: t.id, scope: 'template' }); } catch (e) { console.error(`[NPC Book] ${x.id} card tab failed`, e); host.text(`Error: ${e.message}`); }
    }
    ed.on('click.npcb', '.npcb-ed-genimg', () => {
        toastr.info(`Generating a portrait for ${t.name}…`, 'NPC Book');
        ensurePortrait(t.id, { force: true });
    });
    ed.on('click.npcb', '.npcb-ed-clrimg', () => {
        libState.draftPortrait = '';
        ed.find('.npcb-ed-portrait').html(avatarHtml(null, ed.find('.npcb-ed-name').val() || '?', 'npcb-ava-lg'));
    });
    ed.on('input.npcb', '.npcb-ed-color', (e) => {
        ed.find('.npcb-ed-colorhex').val(e.target.value);
        ed.find('.npcb-color-preview').css('color', e.target.value);
    });
    ed.on('input.npcb', '.npcb-ed-colorhex', (e) => {
        let v = String(e.target.value).trim();
        if (/^[0-9a-f]{6}$/i.test(v)) v = `#${v}`;
        if (HEX_RE.test(v)) { ed.find('.npcb-ed-color').val(v); ed.find('.npcb-color-preview').css('color', v); }
        else if (!v) ed.find('.npcb-color-preview').css('color', 'inherit');
    });
    // Pronouns follow the gender field (male → he/him, female → she/her) until edited by hand.
    ed.on('input.npcb', '.npcb-ed-pronouns', (e) => { e.target.dataset.auto = '0'; });
    ed.on('input.npcb', '.npcb-ed-trait[data-key="gender"]', (e) => {
        const p = ed.find('.npcb-ed-pronouns');
        if (p.attr('data-auto') !== '0') p.val(defaultPronouns(e.target.value));
    });
    ed.on('click.npcb', '.npcb-ed-save', () => saveTemplateFromEditor(t, isNew));
    ed.on('click.npcb', '.npcb-ed-scene', () => {
        if (!hasChat()) { toastr.warning('Open a chat first.', 'NPC Book'); return; }
        if (currentRoster().some(i => i.id === t.id)) removeFromScene(t.id); else addToScene(t.id);
        selectTemplate(t.id);
    });
    ed.on('click.npcb', '.npcb-ed-dup', () => {
        const id2 = uniqueId(t.id, x => !!lib()[x]);
        lib()[id2] = { ...clone(t), id: id2, auto: false, created: Date.now() };
        save();
        selectTemplate(id2);
    });
    ed.on('click.npcb', '.npcb-ed-del', async () => {
        const c = ctx();
        const ok = await c.callGenericPopup(`Delete NPC <b>${esc(t.name)}</b> (${esc(t.id)})? Chats that already met this NPC keep their own copy of it.`, c.POPUP_TYPE.CONFIRM);
        if (!ok) return;
        delete lib()[t.id];
        save();
        libState.selected = null;
        openLibrary();
        renderRoster();
    });
    renderAssist();
}

async function saveTemplateFromEditor(t, isNew) {
    const ed = $('#npcb_library .npcb-lib-editor');
    const name = String(ed.find('.npcb-ed-name').val() ?? '').trim();
    if (!name) { toastr.warning('Name is required.', 'NPC Book'); return; }
    let id = t.id;
    if (isNew) {
        const raw = String(ed.find('.npcb-ed-id').val() ?? '').trim().toLowerCase();
        id = raw || uniqueId(name, x => !!lib()[x]);
        if (!ID_PATTERN.test(id)) { toastr.warning('ID may only contain a–z, 0–9, _ and -, and must start with a letter or digit.', 'NPC Book'); return; }
        if (lib()[id]) { toastr.warning(`ID "${id}" is already taken.`, 'NPC Book'); return; }
    }
    let color = String(ed.find('.npcb-ed-colorhex').val() ?? '').trim();
    if (/^[0-9a-f]{6}$/i.test(color)) color = `#${color}`;
    if (color && !HEX_RE.test(color)) { toastr.warning('Dialogue color must look like #RRGGBB (or be empty).', 'NPC Book'); return; }
    const traits = {};
    ed.find('.npcb-ed-trait').each((_, el) => { traits[$(el).data('key')] = String($(el).val() ?? '').trim(); });
    let portrait = t.portrait || '';
    if (libState.draftPortrait === '') portrait = '';
    else if (libState.draftPortrait && !String(libState.draftPortrait).startsWith('data:')) portrait = libState.draftPortrait;
    else if (libState.draftPortrait) {
        try { portrait = await uploadPortrait(libState.draftPortrait, id); } catch (e) { console.warn('[NPC Book] upload failed, storing inline', e); portrait = libState.draftPortrait; }
    }
    lib()[id] = {
        ...(isNew ? {} : t),
        id, name, portrait,
        folder: normFolder(ed.find('.npcb-ed-folder').val()),
        description: String(ed.find('.npcb-ed-desc').val() ?? ''),
        details: String(ed.find('.npcb-ed-details').val() ?? ''),
        traits,
        height: String(ed.find('.npcb-ed-height').val() ?? '').trim(),
        pronouns: String(ed.find('.npcb-ed-pronouns').val() ?? '').trim(),
        sexuality: String(ed.find('.npcb-ed-sexuality').val() ?? '').trim(),
        sexualExperience: String(ed.find('.npcb-ed-sexexp').val() ?? '').trim(),
        color: color.toLowerCase(),
        outfit: clone(libState.draftOutfit || []),
        dialogue: libState.draftDialogue.filter(d => String(d.text ?? '').trim()).map(d => ({ kind: d.kind || 'always', value: String(d.value ?? '').trim(), text: String(d.text).trim() })),
        ext: clone(libState.draftExt || t.ext || {}),
        auto: isNew ? false : !!t.auto,
        created: t.created || Date.now(),
        updated: Date.now(),
    };
    delete lib()[id].defaultWorn; // the starting outfit is `outfit` now (older cards starred wardrobe items)
    registerFolder(lib()[id].folder);
    save();
    for (const x of extensions.values()) if (x.cardTab && lib()[id].ext?.[x.id] !== undefined) sheetSaved(x, 'cardTab', { id, scope: 'template', data: lib()[id].ext[x.id] });
    toastr.success(`Saved ${name}.`, 'NPC Book');
    // Templates are blueprints: chats that already have an instance of this NPC keep their own copy.
    selectTemplate(id, false, String(ed.find('.npcb-tab.active').data('tab') || 'card'));
    renderRoster();
}
