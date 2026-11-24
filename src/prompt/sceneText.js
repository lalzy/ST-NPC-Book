// Builds the {{npcScene}} XML: user block and one block per NPC in the scene.

import { SLOT_LABEL } from '../constants.js';
import { ctx, hasChat } from '../core/context.js';
import { profileOf } from '../core/npcs.js';
import { extensions } from '../core/runtime.js';
import { settings } from '../core/settings.js';
import { indent, xa, xt } from '../core/utils.js';
import { exposureSummary, findItem } from '../logic/outfit.js';
import { PROFILE_FIELDS } from '../logic/profile.js';
import { normalize } from '../logic/text.js';
import { personaData, personaDescription, promptUser } from '../scene/persona.js';
import { promptRoster } from '../scene/roster.js';

function wearingText(outfit, wardrobe) {
    const s = settings();
    const def = s.conditions[0];
    const parts = (outfit || []).map(w => {
        const it = findItem(wardrobe, w.id);
        if (!it) return null;
        const cond = w.condition && w.condition !== def ? ` (${w.condition})` : '';
        return `${it.slots.map(k => SLOT_LABEL[k] || k).join(' + ')}: ${it.name}${cond}`;
    }).filter(Boolean);
    return parts.length ? parts.join('; ') : 'nothing';
}

function wardrobeText(wardrobe) {
    if (!wardrobe?.length) return '';
    return wardrobe.map(i => `${i.id} = ${i.name} [${i.slots.map(k => SLOT_LABEL[k] || k).join(', ')}]${i.note ? ` (${i.note})` : ''}`).join('; ');
}

function outfitXml(outfit, wardrobe) {
    const s = settings();
    if (!s.trackOutfits) return [];
    if (!wardrobe?.length && !(outfit || []).length) return [];
    const exp = s.describeExposure ? exposureSummary(outfit, wardrobe) : '';
    const out = [`<wearing${exp ? ` exposure="${xa(exp)}"` : ''}>${xt(wearingText(outfit, wardrobe))}</wearing>`];
    if (s.includeWardrobe) { const wt = wardrobeText(wardrobe); if (wt) out.push(`<wardrobe>${xt(wt)}</wardrobe>`); }
    return out;
}

/** XML contributed by sister extensions for one subject. */
function extXml(subject) {
    const out = [];
    for (const ext of extensions.values()) {
        if (typeof ext.sceneXml !== 'function') continue;
        try {
            const data = subject.kind === 'user' ? personaData().ext?.[ext.id] : subject.template?.ext?.[ext.id];
            if (!data) continue;
            const xml = ext.sceneXml({ ...subject, data });
            if (xml && String(xml).trim()) out.push(String(xml).trim());
        } catch (e) { console.warn(`[NPC Book] extension ${ext.id} sceneXml failed`, e); }
    }
    return out;
}

function buildUserBlock() {
    const s = settings();
    const c = ctx();
    const inner = [];
    if (s.personaInUser) { const d = personaDescription().trim(); if (d) inner.push(`<description>${xt(d)}</description>`); }
    if (s.trackUser) {
        const u = promptUser();
        const p = personaData();
        if (u.posture) inner.push(`<state posture="${xa(u.posture)}"/>`);
        inner.push(...outfitXml(u.outfit, p.wardrobe));
    }
    inner.push(...extXml({ kind: 'user', name: c.name1 }));
    if (!inner.length) return '';
    return [`<user name="${xa(c.name1)}">`, ...inner.map(x => indent(x, 2)), '</user>'].join('\n');
}

/**
 * Dialogue examples to send for an NPC right now. "mood" examples only while the NPC is in that state;
 * "situation" examples always, labeled with the situation; "always" examples always.
 */
function dialogueExamplesFor(t, inst) {
    const out = [];
    for (const d of t?.dialogue || []) {
        const text = String(d?.text ?? '').trim();
        if (!text) continue;
        if (d.kind === 'mood') {
            if (!d.value || normalize(d.value) !== normalize(inst?.state)) continue;
            out.push({ when: `mood: ${d.value}`, text });
        } else if (d.kind === 'situation' && String(d.value ?? '').trim()) {
            out.push({ when: String(d.value).trim(), text });
        } else {
            out.push({ when: '', text });
        }
    }
    return out;
}

/** One NPC's <char> block, built from the chat's instance only (it carries its own card fields, wardrobe and ext data). */
function buildCharBlock(inst) {
    const s = settings();
    const t = inst;
    const name = t?.name ?? inst.name ?? inst.id;
    const inner = [];
    const prof = profileOf(t);
    const idAttrs = s.traitKeys.map(k => (t?.traits?.[k] ? ` ${k}="${xa(t.traits[k])}"` : '')).join('')
        + PROFILE_FIELDS.map(f => (prof[f.key] ? ` ${f.attr}="${xa(prof[f.key])}"` : '')).join('');
    if (idAttrs) inner.push(`<identity${idAttrs}/>`);
    const details = (t?.details ?? '').trim();
    if (details) inner.push(`<details>${xt(details)}</details>`);
    const examples = dialogueExamplesFor(t, inst);
    if (examples.length) inner.push(['<dialogue_examples>', ...examples.map(e => indent(`<example${e.when ? ` when="${xa(e.when)}"` : ''}>${xt(e.text)}</example>`, 2)), '</dialogue_examples>'].join('\n'));
    const stAttrs = [
        inst.posture && `posture="${xa(inst.posture)}"`,
        inst.state && `mood="${xa(inst.state)}"`,
    ].filter(Boolean).join(' ');
    if (stAttrs) inner.push(`<state ${stAttrs}/>`);
    if (inst.feelings) inner.push(`<feelings>${xt(inst.feelings)}</feelings>`);
    inner.push(...outfitXml(inst.outfit, t?.wardrobe));
    inner.push(...extXml({ kind: 'char', name, id: inst.id, template: t, instance: inst }));
    return [`<char name="${xa(name)}" id="${xa(inst.id)}">`, ...inner.map(x => indent(x, 2)), '</char>'].join('\n');
}

export function buildSceneText() {
    const s = settings();
    if (!s.enabled || !hasChat()) return '';
    const roster = promptRoster();
    const userBlock = buildUserBlock();
    if (!roster.length && !userBlock) return '';
    const parts = [];
    if (s.sceneHeader) parts.push(s.sceneHeader);
    if (userBlock) parts.push(userBlock);
    if (roster.length) parts.push(['<characters>', ...roster.map(buildCharBlock), '</characters>'].join('\n'));
    return parts.join('\n');
}
