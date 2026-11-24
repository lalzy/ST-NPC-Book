// Wardrobe editor widget: item list, starting outfit, bulk actions.

import { SLOT_LABEL } from '../../constants.js';
import { save, settings } from '../../core/settings.js';
import { clone, esc } from '../../core/utils.js';
import { outfitBySlot, wearItem } from '../../logic/outfit.js';
import { SLOTS, STACKING_SLOTS, inferSlots } from '../../logic/slots.js';
import { normalize, uniqueId } from '../../logic/text.js';

const wardrobeUi = new Map(); // per owner (NPC id / persona key), this session: { open: Set<slot> } of unfolded groups
const GROUP_FOLD = 5;
export const SLOT_SHORT = { head: 'Head', hair: 'Hair', face: 'Face', glasses: 'Glasses', piercings: 'Piercings', neck: 'Neck', cover: 'Cover', upper_outer: 'Upper', upper_inner: 'Upper inner', hands: 'Hands', waist: 'Waist', lower_outer: 'Lower', lower_inner: 'Lower inner', feet_outer: 'Feet', feet_inner: 'Feet inner', other: 'Other' };
const slotIndex = (k) => SLOTS.findIndex(x => x.key === k);
const primarySlot = (item) => [...(item.slots || [])].sort((a, b) => slotIndex(a) - slotIndex(b))[0] || 'other';

/**
 * Wardrobe editor: collapsible starting-outfit doll on the left, compact item list on the right
 * (grouped by slot, search, filters, sort, inline item editor, bulk actions, quick add).
 * Mutates data = { wardrobe: [], defaultWorn: [] } in place. Returns { refresh }.
 * startingOutfit: false hides everything about the starting outfit (doll, ★ marks, ★ filter, ★ bulk action) —
 * for a chat's NPC instance, whose current outfit is edited elsewhere and which has no starting outfit.
 */
export function mountWardrobe(host, data, { key = '', onChange, startingOutfit = true } = {}) {
    const s = settings();
    if (!Array.isArray(data.defaultWorn)) data.defaultWorn = [];
    if (!wardrobeUi.has(key)) wardrobeUi.set(key, { open: new Set() });
    const ui = wardrobeUi.get(key);
    const st = { q: '', slot: '', starOnly: false, sort: 'slot', expanded: null, selected: new Set() };
    host.html(`<div class="npcb-wdx ${!startingOutfit ? 'npcb-doll-collapsed npcb-wdx-nostart' : s.wardrobeDollCollapsed ? 'npcb-doll-collapsed' : ''}">
        ${startingOutfit ? `<div class="npcb-wdx-doll">
            <div class="npcb-wdx-dollhead"><span>Starting outfit</span><i class="fa-solid fa-angles-left npcb-wdx-dolltoggle" title="Hide starting outfit"></i></div>
            <div class="npcb-wdx-grid"></div>
            <small class="npcb-dim npcb-wdx-hint"></small>
        </div>` : ''}
        <div class="npcb-wdx-list">
            <div class="npcb-wdx-tb">
                ${startingOutfit ? '<i class="fa-solid fa-angles-right npcb-wdx-dollshow" title="Show starting outfit"></i>' : ''}
                <input type="search" class="text_pole npcb-wdx-q" placeholder="Search…">
                <select class="text_pole npcb-wdx-slot"><option value="">All slots</option>${SLOTS.map(x => `<option value="${x.key}">${esc(x.label)}</option>`).join('')}</select>
                ${startingOutfit ? '<span class="npcb-chip npcb-wdx-staronly" title="Only items worn at the start">★</span>' : ''}
                <select class="text_pole npcb-wdx-sort"><option value="slot">By slot</option><option value="name">By name</option><option value="recent">Newest</option></select>
            </div>
            <div class="npcb-wdx-rows"></div>
            <div class="npcb-wdx-bulk" style="display:none"></div>
            <div class="npcb-wdx-add"><i class="fa-solid fa-plus"></i><input class="text_pole npcb-wdx-new" placeholder="New item… (Enter)"><small class="npcb-dim npcb-wdx-newslot"></small></div>
        </div>
    </div>`);
    const root = host.find('.npcb-wdx');
    const byId = (id) => data.wardrobe.find(i => i.id === id);
    const isStar = (id) => data.defaultWorn.includes(id);
    const changed = () => onChange?.(data);
    const setStar = (id, on) => {
        data.defaultWorn = data.defaultWorn.filter(x => x !== id);
        if (on) data.defaultWorn = wearItem(data.defaultWorn.map(x => ({ id: x })), data.wardrobe, id, s.conditions[0]).outfit.map(w => w.id);
    };
    const removeIds = (ids) => {
        data.wardrobe = data.wardrobe.filter(i => !ids.has(i.id));
        data.defaultWorn = data.defaultWorn.filter(x => !ids.has(x));
        for (const id of ids) st.selected.delete(id);
        if (ids.has(st.expanded)) st.expanded = null;
    };

    const drawDoll = () => {
        if (!startingOutfit) return;
        const by = outfitBySlot(data.defaultWorn.map(id => ({ id })), data.wardrobe);
        root.find('.npcb-wdx-grid').html(SLOTS.map((x) => {
            const n = data.wardrobe.filter(i => i.slots.includes(x.key)).length;
            const worn = by[x.key].map(w => esc(w.item.name)).join(', ');
            return `<div class="npcb-wdx-cell ${st.slot === x.key ? 'sel' : ''} ${worn ? 'filled' : ''} ${STACKING_SLOTS.has(x.key) ? 'stack' : ''}" data-slot="${x.key}" style="grid-area:${x.key}">
                <div class="npcb-wdx-cl"><span>${esc(x.label)}</span><span>${n || ''}</span></div>
                <div class="npcb-wdx-cw">${worn || '<span class="npcb-dim">—</span>'}</div></div>`;
        }).join(''));
    };
    const rowHtml = (it) => {
        const sel = st.selected.has(it.id);
        const open = st.expanded === it.id;
        return `<div class="npcb-wdx-row ${open ? 'exp' : ''} ${sel ? 'sel' : ''}" data-item="${esc(it.id)}">
            <input type="checkbox" class="npcb-wdx-pick" ${sel ? 'checked' : ''} title="Select">
            ${startingOutfit ? `<span class="npcb-wdx-star ${isStar(it.id) ? 'on' : ''}" title="Worn at the start">★</span>` : ''}
            <span class="npcb-wdx-name">${esc(it.name)}</span>
            ${it.note ? `<i class="fa-solid fa-note-sticky npcb-dim" title="${esc(it.note)}"></i>` : ''}
            <span class="npcb-wdx-badges">${it.slots.map(k => `<span class="npcb-wdx-badge">${esc(SLOT_SHORT[k] || k)}</span>`).join('')}</span>
            <i class="fa-solid fa-ellipsis npcb-wdx-dots" title="Edit"></i>
        </div>${open ? `<div class="npcb-wdx-ed" data-item="${esc(it.id)}">
            <div class="npcb-wdx-edmain">
                <label>Name<input class="text_pole npcb-wdx-edname" value="${esc(it.name)}"></label>
                <label>Note <small class="npcb-dim">(optional, sent to the LLM)</small><input class="text_pole npcb-wdx-ednote" value="${esc(it.note || '')}" placeholder="e.g. only worn for festivals"></label>
                <div class="npcb-row"><div class="menu_button npcb-wdx-dup"><i class="fa-solid fa-clone"></i> Duplicate</div><div class="menu_button redWarningBG npcb-wdx-del"><i class="fa-solid fa-trash-can"></i> Delete</div><small class="npcb-dim">id: ${esc(it.id)}</small></div>
            </div>
            <div><div class="npcb-wdx-sec">Covers</div><div class="npcb-wdx-mini">${SLOTS.map(x => `<div class="npcb-wdx-mc ${it.slots.includes(x.key) ? 'on' : ''}" data-slot="${x.key}" style="grid-area:${x.key}">${esc(x.label)}</div>`).join('')}</div></div>
        </div>` : ''}`;
    };
    const drawRows = () => {
        const q = normalize(st.q);
        const filtering = !!(q || st.slot || st.starOnly);
        let items = data.wardrobe.filter(i => (!st.slot || i.slots.includes(st.slot)) && (!st.starOnly || isStar(i.id)) && (!q || normalize(`${i.name} ${i.note || ''}`).includes(q)));
        let html = '';
        if (!data.wardrobe.length) html = '<div class="npcb-empty">No clothing yet. Add items below, or use ✨ Assist.</div>';
        else if (!items.length) html = '<div class="npcb-empty">No matching items.</div>';
        else if (st.sort === 'slot') {
            for (const x of SLOTS) {
                const group = items.filter(i => primarySlot(i) === x.key);
                if (!group.length) continue;
                const foldable = !filtering && group.length > GROUP_FOLD + 1;
                const open = !foldable || ui.open.has(x.key) || group.slice(GROUP_FOLD).some(i => i.id === st.expanded);
                html += `<div class="npcb-wdx-grp">${esc(x.label)} · ${group.length}</div>${(open ? group : group.slice(0, GROUP_FOLD)).map(rowHtml).join('')}`;
                if (foldable) html += `<div class="npcb-wdx-more" data-slot="${x.key}">${open ? '▴ Show less' : `▸ ${group.length - GROUP_FOLD} more`}</div>`;
            }
        } else {
            items = st.sort === 'name' ? [...items].sort((a, b) => a.name.localeCompare(b.name)) : [...items].reverse();
            html = items.map(rowHtml).join('');
        }
        root.find('.npcb-wdx-rows').html(html);
        const n = st.selected.size;
        root.find('.npcb-wdx-bulk').toggle(n > 0).html(n ? `<b>${n} selected</b><span class="npcb-spacer"></span>
            <select class="text_pole npcb-wdx-bulkslot"><option value="">Set slot…</option>${SLOTS.map(x => `<option value="${x.key}">${esc(x.label)}</option>`).join('')}</select>
            ${startingOutfit ? '<div class="menu_button npcb-wdx-bulkstar">★ Starting</div>' : ''}
            <div class="menu_button redWarningBG npcb-wdx-bulkdel"><i class="fa-solid fa-trash-can"></i></div>
            <div class="menu_button npcb-wdx-bulkclear" title="Clear selection"><i class="fa-solid fa-xmark"></i></div>` : '');
        root.find('.npcb-wdx-newslot').text(`slot: ${st.slot ? SLOT_LABEL[st.slot] : 'auto'}`);
        root.find('.npcb-wdx-hint').html(st.slot
            ? `<b>${esc(SLOT_LABEL[st.slot])}</b>: click an item to put it on or take it off${STACKING_SLOTS.has(st.slot) ? ' (this slot holds several)' : ''}. ⋯ edits it. Click the slot again to clear.`
            : '★ in the list = worn at the start. Click a slot to dress it.');
    };
    const draw = () => { drawDoll(); drawRows(); };
    const itemOf = (el) => byId($(el).closest('[data-item]').data('item'));

    host.off('.wdx');
    host.on('click.wdx', '.npcb-wdx-dolltoggle, .npcb-wdx-dollshow', () => {
        s.wardrobeDollCollapsed = !s.wardrobeDollCollapsed;
        save();
        root.toggleClass('npcb-doll-collapsed', s.wardrobeDollCollapsed);
    });
    host.on('click.wdx', '.npcb-wdx-cell', (e) => {
        const k = $(e.currentTarget).data('slot');
        st.slot = st.slot === k ? '' : k;
        root.find('.npcb-wdx-slot').val(st.slot);
        draw();
    });
    host.on('input.wdx', '.npcb-wdx-q', (e) => { st.q = String(e.target.value); drawRows(); });
    host.on('change.wdx', '.npcb-wdx-slot', (e) => { st.slot = String(e.target.value); draw(); });
    host.on('change.wdx', '.npcb-wdx-sort', (e) => { st.sort = String(e.target.value); drawRows(); });
    host.on('click.wdx', '.npcb-wdx-staronly', (e) => { st.starOnly = !st.starOnly; $(e.currentTarget).toggleClass('on', st.starOnly); drawRows(); });
    host.on('click.wdx', '.npcb-wdx-more', (e) => {
        const k = $(e.currentTarget).data('slot');
        if (ui.open.has(k)) ui.open.delete(k); else ui.open.add(k);
        drawRows();
    });
    host.on('click.wdx', '.npcb-wdx-row', (e) => {
        if ($(e.target).is('.npcb-wdx-pick, .npcb-wdx-star')) return;
        const id = $(e.currentTarget).data('item');
        if (startingOutfit && st.slot && !$(e.target).is('.npcb-wdx-dots')) {
            setStar(id, !isStar(id));
            draw(); changed();
            return;
        }
        st.expanded = st.expanded === id ? null : id;
        drawRows();
    });
    host.on('click.wdx', '.npcb-wdx-star', (e) => {
        const it = itemOf(e.target);
        if (!it) return;
        setStar(it.id, !isStar(it.id));
        draw(); changed();
    });
    host.on('change.wdx', '.npcb-wdx-pick', (e) => {
        const it = itemOf(e.target);
        if (!it) return;
        if (e.target.checked) st.selected.add(it.id); else st.selected.delete(it.id);
        drawRows();
    });
    host.on('input.wdx', '.npcb-wdx-edname', (e) => {
        const it = itemOf(e.target);
        if (!it) return;
        it.name = String(e.target.value);
        root.find('.npcb-wdx-row').filter((_, el) => $(el).data('item') === it.id).find('.npcb-wdx-name').text(it.name);
        drawDoll(); changed();
    });
    host.on('input.wdx', '.npcb-wdx-ednote', (e) => { const it = itemOf(e.target); if (it) { it.note = String(e.target.value).trim(); changed(); } });
    host.on('click.wdx', '.npcb-wdx-mc', (e) => {
        const it = itemOf(e.target);
        if (!it) return;
        const k = $(e.currentTarget).data('slot');
        it.slots = it.slots.includes(k) ? it.slots.filter(x => x !== k) : [...it.slots, k].sort((a, b) => slotIndex(a) - slotIndex(b));
        if (!it.slots.length) it.slots = [k];
        if (isStar(it.id)) setStar(it.id, true);
        draw(); changed();
    });
    host.on('click.wdx', '.npcb-wdx-dup', (e) => {
        const it = itemOf(e.target);
        if (!it) return;
        const copy = { ...clone(it), id: uniqueId(it.id, x => !!byId(x)), name: `${it.name} (copy)` };
        data.wardrobe.splice(data.wardrobe.indexOf(it) + 1, 0, copy);
        st.expanded = copy.id;
        draw(); changed();
    });
    host.on('click.wdx', '.npcb-wdx-del', (e) => {
        const it = itemOf(e.target);
        if (!it) return;
        removeIds(new Set([it.id]));
        draw(); changed();
    });
    host.on('change.wdx', '.npcb-wdx-bulkslot', (e) => {
        const k = String(e.target.value);
        if (!k) return;
        for (const id of st.selected) { const it = byId(id); if (it) { it.slots = [k]; if (isStar(id)) setStar(id, true); } }
        draw(); changed();
    });
    host.on('click.wdx', '.npcb-wdx-bulkstar', () => { for (const id of st.selected) setStar(id, true); draw(); changed(); });
    host.on('click.wdx', '.npcb-wdx-bulkdel', () => { removeIds(new Set(st.selected)); draw(); changed(); });
    host.on('click.wdx', '.npcb-wdx-bulkclear', () => { st.selected.clear(); drawRows(); });
    host.on('keydown.wdx', '.npcb-wdx-new', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const name = String($(e.target).val() ?? '').trim();
        if (!name) return;
        const item = { id: uniqueId(name, x => !!byId(x)), name, slots: st.slot ? [st.slot] : inferSlots(name), note: '' };
        data.wardrobe.push(item);
        st.expanded = item.id; // open it, so the guessed slots can be checked right away
        $(e.target).val('');
        draw(); changed();
        root.find('.npcb-wdx-row').filter((_, el) => $(el).data('item') === item.id)[0]?.scrollIntoView({ block: 'nearest' });
    });
    draw();
    return { refresh: draw };
}
