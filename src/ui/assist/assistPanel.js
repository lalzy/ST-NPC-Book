// LLM assist side panel: render, run, apply and event wiring.

import { ctx } from '../../core/context.js';
import { settings } from '../../core/settings.js';
import { esc } from '../../core/utils.js';
import { wearItem } from '../../logic/outfit.js';
import { SLOTS } from '../../logic/slots.js';
import { normalize, uniqueId } from '../../logic/text.js';
import { libState } from '../library/state.js';
import { SLOT_SHORT } from '../wardrobe/wardrobeEditor.js';
import { assistJson, buildCardAssist, buildWardrobeAssist, readCardAnswer, readWardrobeAnswer } from './assistPrompts.js';
import { ASSIST_FIELDS, ASSIST_TEXTAREA, assist, editorTab, isEmptyValue, libEd, readCardEditor, valueText } from './assistState.js';

function markAssistTargets() {
    const ed = libEd();
    ed.find('.npcb-assist-target').removeClass('npcb-assist-target');
    if (!assist.open || editorTab() !== 'card' || !assist.card.fields) return;
    for (const f of ASSIST_FIELDS) if (assist.card.fields.has(f.key)) ed.find(f.sel).addClass('npcb-assist-target');
}

export function renderAssist() {
    const panel = $('#npcb_library .npcb-assist');
    if (!panel.length) return;
    $('#npcb_library .npcb-modal-panel').toggleClass('npcb-assist-open', assist.open);
    libEd().find('.npcb-ed-assist').toggleClass('active', assist.open);
    if (!assist.open || !libEd().find('.npcb-tabs').length) { panel.hide().empty(); markAssistTargets(); return; }
    const mode = editorTab() === 'wardrobe' ? 'wardrobe' : 'card';
    if (mode === 'card' && !assist.card.fields) {
        const cur = readCardEditor();
        const empty = ASSIST_FIELDS.filter(f => f.key !== 'color' && isEmptyValue(cur[f.key])).map(f => f.key);
        assist.card.fields = new Set(empty.length ? empty : ['details']);
    }
    panel.show().html(mode === 'card' ? assistCardHtml() : assistWardrobeHtml());
    markAssistTargets();
}

function assistFoot(st, applyLabel, note) {
    return `<div class="npcb-assist-foot">
        <textarea class="text_pole npcb-as-prompt" rows="3" placeholder="Describe what you want…">${esc(st.prompt)}</textarea>
        <div class="npcb-row">
            ${assist.busy
                ? '<div class="menu_button npcb-as-stop" title="Stop generating"><i class="fa-solid fa-stop"></i> Stop</div>'
                : '<div class="menu_button npcb-as-gen"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</div>'}
            <div class="menu_button npcb-as-refine ${assist.busy || !st.result ? 'disabled' : ''}" title="Change the last answer according to your prompt"><i class="fa-solid fa-rotate"></i> Refine</div>
            <span class="npcb-spacer"></span>
            ${applyLabel ? `<div class="menu_button npcb-as-apply ${assist.busy ? 'disabled' : ''}">${esc(applyLabel)}</div>` : ''}
        </div>
        <small class="npcb-dim">${esc(note)}</small>
    </div>`;
}

function assistCardHtml() {
    const c = assist.card;
    const cur = readCardEditor();
    let result = '<div class="npcb-empty">Pick the fields to write, describe what you want below, and press Generate.</div>';
    if (c.result) {
        result = Object.entries(c.result).map(([k, v]) => {
            const f = ASSIST_FIELDS.find(x => x.key === k);
            const old = valueText(cur[k]);
            let input;
            if (k === 'identity') {
                input = `<div class="npcb-as-ident">${Object.entries(v).map(([tk, tv]) => `<label>${esc(tk)}<input class="text_pole npcb-as-val" data-field="identity" data-key="${esc(tk)}" value="${esc(tv)}"></label>`).join('')}</div>`;
            } else if (ASSIST_TEXTAREA.has(k)) {
                input = `<textarea class="text_pole npcb-as-val" data-field="${k}" rows="${k === 'details' ? 7 : 2}">${esc(v)}</textarea>`;
            } else {
                input = `<input class="text_pole npcb-as-val" data-field="${k}" value="${esc(v)}">`;
            }
            const same = old && old === valueText(v);
            return `<div class="npcb-as-prop" data-field="${k}">
                <label class="checkbox_label"><input type="checkbox" class="npcb-as-accept" ${c.accept.has(k) ? 'checked' : ''}> <b>${esc(f?.label || k)}</b></label>
                ${old && !same ? `<div class="npcb-as-old">${esc(old)}</div>` : ''}${input}
            </div>`;
        }).join('');
    }
    const n = c.result ? [...c.accept].filter(k => k in c.result).length : 0;
    return `<div class="npcb-assist-head"><b><i class="fa-solid fa-wand-magic-sparkles"></i> Assist · Card</b><span class="npcb-spacer"></span><div class="menu_button npcb-as-close" title="Close"><i class="fa-solid fa-xmark"></i></div></div>
    <div class="npcb-assist-body">
        <div class="npcb-assist-sec">Generate these fields</div>
        <div class="npcb-assist-chips">${ASSIST_FIELDS.map(f => `<span class="npcb-chip ${c.fields.has(f.key) ? 'on' : ''}" data-field="${f.key}">${esc(f.label)}</span>`).join('')}</div>
        <label class="checkbox_label"><input type="checkbox" class="npcb-as-opt" data-opt="useCard" ${c.useCard ? 'checked' : ''}> Use what's already on the card</label>
        <label class="checkbox_label"><input type="checkbox" class="npcb-as-opt" data-opt="useChat" ${c.useChat ? 'checked' : ''}> Include recent chat</label>
        <div class="npcb-assist-sec">Response</div>
        ${result}
    </div>
    ${assistFoot(c, c.result ? `Apply ${n} field${n === 1 ? '' : 's'}` : '', 'Applied values go into the editor; nothing is saved until you press Save.')}`;
}

function assistWardrobeHtml() {
    const w = assist.wardrobe;
    const owned = new Set((libState.draftWardrobe?.wardrobe || []).map(i => normalize(i.name)));
    let result = '<div class="npcb-empty">Describe the style you want below and press Generate. The card\'s details are used as context.</div>';
    if (w.result) {
        result = `<div class="npcb-assist-sec">Response · ${w.result.items.length} items</div>` + w.result.items.map((it, i) => `<div class="npcb-as-item" data-i="${i}">
            <div class="npcb-row"><input type="checkbox" class="npcb-as-take" ${it.take ? 'checked' : ''}><input class="text_pole npcb-as-iname" value="${esc(it.name)}">${owned.has(normalize(it.name)) ? '<span class="npcb-as-owned">already owned</span>' : ''}${w.result.starting.has(i) ? '<span class="npcb-as-start" title="Starting outfit">★</span>' : ''}</div>
            <div class="npcb-as-slots">${SLOTS.map(x => `<span class="npcb-chip ${it.slots.includes(x.key) ? 'on' : ''}" data-slot="${x.key}">${esc(SLOT_SHORT[x.key])}</span>`).join('')}<span class="npcb-chip npcb-as-slotedit" title="Change slots">✎</span></div>
            ${it.note ? `<small class="npcb-dim">${esc(it.note)}</small>` : ''}
        </div>`).join('');
    }
    const n = w.result ? w.result.items.filter(x => x.take).length : 0;
    return `<div class="npcb-assist-head"><b><i class="fa-solid fa-wand-magic-sparkles"></i> Assist · Wardrobe</b><span class="npcb-spacer"></span><div class="menu_button npcb-as-close" title="Close"><i class="fa-solid fa-xmark"></i></div></div>
    <div class="npcb-assist-body">
        <div class="npcb-row">
            <label>Items<input type="number" min="1" max="30" class="text_pole npcb-as-wopt" data-opt="count" value="${w.count}"></label>
            <label>Mode<select class="text_pole npcb-as-wopt" data-opt="mode"><option value="add" ${w.mode === 'add' ? 'selected' : ''}>Add to wardrobe</option><option value="replace" ${w.mode === 'replace' ? 'selected' : ''}>Replace wardrobe</option></select></label>
        </div>
        <label class="checkbox_label"><input type="checkbox" class="npcb-as-wopt" data-opt="cover" ${w.cover ? 'checked' : ''}> Cover the basics (underwear, sleepwear, footwear)</label>
        <label class="checkbox_label"><input type="checkbox" class="npcb-as-wopt" data-opt="start" ${w.start ? 'checked' : ''}> Also pick a starting outfit (★)</label>
        ${result}
    </div>
    ${assistFoot(w, w.result ? `${w.mode === 'replace' ? 'Replace with' : 'Add'} ${n} item${n === 1 ? '' : 's'}` : '', 'Items go into the wardrobe editor; nothing is saved until you press Save.')}`;
}

async function runAssist(refine) {
    if (assist.busy) return;
    const mode = editorTab() === 'wardrobe' ? 'wardrobe' : 'card';
    const st = assist[mode];
    if (refine && (!st.result || !st.prompt.trim())) { toastr.info('Write what to change in the prompt box, then press Refine.', 'NPC Book'); return; }
    const owner = assist.owner;
    const run = {};
    assist.run = run;
    assist.busy = true;
    renderAssist();
    try {
        const { systemPrompt, prompt } = mode === 'card' ? buildCardAssist(refine) : buildWardrobeAssist(refine);
        const answer = await ctx().generateRaw({ systemPrompt, prompt });
        if (assist.run !== run || assist.owner !== owner) return; // stopped, or switched NPC meanwhile
        const json = assistJson(answer);
        if (mode === 'card') readCardAnswer(json); else readWardrobeAnswer(json);
    } catch (e) {
        if (assist.run !== run) return; // stopped by the user
        console.warn('[NPC Book] assist failed', e);
        toastr.error(`Assist failed: ${e?.message || e}`, 'NPC Book');
    } finally {
        if (assist.run === run) {
            assist.run = null;
            assist.busy = false;
            renderAssist();
        }
    }
}

function stopAssist() {
    if (!assist.busy) return;
    assist.run = null;
    assist.busy = false;
    try { ctx().stopGeneration?.(); } catch (e) { console.warn('[NPC Book] stop failed', e); }
    renderAssist();
    toastr.info('Assist stopped.', 'NPC Book');
}

function applyCardAssist() {
    const c = assist.card;
    if (!c.result) return;
    const ed = libEd();
    let n = 0;
    for (const [k, v] of Object.entries(c.result)) {
        if (!c.accept.has(k)) continue;
        if (k === 'identity') {
            for (const [tk, tv] of Object.entries(v)) ed.find('.npcb-ed-trait').filter((_, el) => $(el).data('key') === tk).val(tv).trigger('input');
        } else {
            const f = ASSIST_FIELDS.find(x => x.key === k);
            ed.find(f.sel).val(v).trigger('input');
        }
        n++;
    }
    toastr.success(`Applied ${n} field${n === 1 ? '' : 's'}. Press Save to keep them.`, 'NPC Book');
}

function applyWardrobeAssist() {
    const w = assist.wardrobe;
    const d = libState.draftWardrobe;
    if (!w.result || !d) return;
    const s = settings();
    if (w.mode === 'replace') { d.wardrobe = []; d.defaultWorn = []; }
    const newIds = new Map();
    let n = 0;
    w.result.items.forEach((it, i) => {
        if (!it.take || !it.name.trim()) return;
        const have = d.wardrobe.find(x => normalize(x.name) === normalize(it.name));
        if (have) { newIds.set(i, have.id); return; }
        const id = uniqueId(it.name, x => d.wardrobe.some(y => y.id === x));
        d.wardrobe.push({ id, name: it.name.trim(), slots: it.slots.length ? it.slots : ['other'], note: it.note });
        newIds.set(i, id);
        n++;
    });
    if (w.start && w.result.starting.size) {
        let worn = w.mode === 'replace' ? [] : d.defaultWorn.map(id => ({ id }));
        for (const i of w.result.starting) if (newIds.has(i)) worn = wearItem(worn, d.wardrobe, newIds.get(i), s.conditions[0]).outfit;
        d.defaultWorn = worn.map(x => x.id);
    }
    w.result = null;
    libState.wardrobeUi?.refresh();
    libEd().find('.npcb-tab[data-tab="wardrobe"]').text(`Wardrobe (${d.wardrobe.length})`);
    toastr.success(`${w.mode === 'replace' ? 'Wardrobe replaced' : 'Added'}: ${n} item${n === 1 ? '' : 's'}. Press Save to keep them.`, 'NPC Book');
}

export function bindAssist(modal) {
    modal.on('click', '.npcb-ed-assist', () => { assist.open = !assist.open; renderAssist(); });
    const panel = modal.find('.npcb-assist');
    panel.on('click', '.npcb-as-close', () => { assist.open = false; renderAssist(); });
    panel.on('click', '.npcb-assist-chips .npcb-chip', (e) => {
        const k = $(e.currentTarget).data('field');
        const f = assist.card.fields;
        if (f.has(k)) f.delete(k); else f.add(k);
        $(e.currentTarget).toggleClass('on', f.has(k));
        markAssistTargets();
    });
    panel.on('change', '.npcb-as-opt', (e) => { assist.card[$(e.target).data('opt')] = e.target.checked; });
    panel.on('input change', '.npcb-as-wopt', (e) => {
        const k = $(e.target).data('opt');
        assist.wardrobe[k] = e.target.type === 'checkbox' ? e.target.checked : k === 'count' ? Number(e.target.value) : String(e.target.value);
        if (k === 'mode' && assist.wardrobe.result) renderAssist();
    });
    panel.on('input', '.npcb-as-prompt', (e) => { assist[editorTab() === 'wardrobe' ? 'wardrobe' : 'card'].prompt = String(e.target.value); });
    panel.on('keydown', '.npcb-as-prompt', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runAssist(false); } });
    panel.on('click', '.npcb-as-gen', () => runAssist(false));
    panel.on('click', '.npcb-as-stop', stopAssist);
    panel.on('click', '.npcb-as-refine', () => runAssist(true));
    panel.on('click', '.npcb-as-apply', () => { if (assist.busy) return; if (editorTab() === 'wardrobe') applyWardrobeAssist(); else applyCardAssist(); renderAssist(); });
    // card proposals
    panel.on('change', '.npcb-as-accept', (e) => {
        const k = $(e.target).closest('.npcb-as-prop').data('field');
        if (e.target.checked) assist.card.accept.add(k); else assist.card.accept.delete(k);
        const n = [...assist.card.accept].filter(x => x in (assist.card.result || {})).length;
        panel.find('.npcb-as-apply').text(`Apply ${n} field${n === 1 ? '' : 's'}`);
    });
    panel.on('input', '.npcb-as-val', (e) => {
        const r = assist.card.result;
        if (!r) return;
        const k = $(e.target).data('field');
        if (k === 'identity') r.identity[$(e.target).data('key')] = String(e.target.value); else r[k] = String(e.target.value);
    });
    // wardrobe proposals
    const itemAt = (el) => assist.wardrobe.result?.items[Number($(el).closest('.npcb-as-item').data('i'))];
    panel.on('change', '.npcb-as-take', (e) => {
        const it = itemAt(e.target);
        if (!it) return;
        it.take = e.target.checked;
        const n = assist.wardrobe.result.items.filter(x => x.take).length;
        panel.find('.npcb-as-apply').text(`${assist.wardrobe.mode === 'replace' ? 'Replace with' : 'Add'} ${n} item${n === 1 ? '' : 's'}`);
    });
    panel.on('input', '.npcb-as-iname', (e) => { const it = itemAt(e.target); if (it) it.name = String(e.target.value); });
    panel.on('click', '.npcb-as-slotedit', (e) => { $(e.currentTarget).closest('.npcb-as-slots').toggleClass('open'); });
    panel.on('click', '.npcb-as-slots .npcb-chip[data-slot]', (e) => {
        const it = itemAt(e.target);
        if (!it) return;
        const k = $(e.currentTarget).data('slot');
        it.slots = it.slots.includes(k) ? it.slots.filter(x => x !== k) : [...it.slots, k];
        if (!it.slots.length) it.slots = [k];
        $(e.currentTarget).closest('.npcb-as-slots').find('.npcb-chip').each((_, c) => $(c).toggleClass('on', it.slots.includes($(c).data('slot'))));
    });
}
