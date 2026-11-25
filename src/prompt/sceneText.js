// Builds the {{npcScene}} XML: user block and one block per NPC in the scene.

import { SLOT_LABEL } from '../constants.js';
import { ctx, hasChat } from '../core/context.js';
import { profileOf } from '../core/npcs.js';
import { pipe } from '../core/extHooks.js';
import { extensions } from '../core/runtime.js';
import { settings } from '../core/settings.js';
import { indent, xa, xt } from '../core/utils.js';
import { exposureSummary, resolveOutfit } from '../logic/outfit.js';
import { PROFILE_FIELDS } from '../logic/profile.js';
import { normalize } from '../logic/text.js';
import { personaData, personaDescription, promptUser } from '../scene/persona.js';
import { promptRoster, promptScene } from '../scene/roster.js';

function wearingText(outfit) {
    const s = settings();
    const def = s.conditions[0];
    const parts = (outfit || []).map(w => {
        const cond = w.condition && w.condition !== def ? ` (${w.condition})` : '';
        return `${(w.slots || []).map(k => SLOT_LABEL[k] || k).join(' + ')}: ${w.name}${cond}`;
    });
    return parts.length ? parts.join('; ') : 'nothing';
}

/** <wearing> for a character: what they have on now (self-contained items; older saves resolve through `legacyWardrobe`). */
function outfitXml(outfit, legacyWardrobe, dressed = false) {
    const s = settings();
    if (!s.trackOutfits) return [];
    const worn = resolveOutfit(outfit, legacyWardrobe || []);
    // Someone whose clothing was never set (no outfit, never dressed or undressed) gets no <wearing> line.
    if (!worn.length && !dressed && !(legacyWardrobe || []).length) return [];
    const exp = s.describeExposure ? exposureSummary(worn) : '';
    return [`<wearing${exp ? ` exposure="${xa(exp)}"` : ''}>${xt(wearingText(worn))}</wearing>`];
}

/** XML contributed by sister extensions for one subject. */
function extXml(subject) {
    const out = [];
    for (const ext of extensions.values()) {
        if (typeof ext.sceneXml !== 'function') continue;
        try {
            // sceneXmlAlways: also called for characters without data for this extension (e.g. to read older data).
            // The user's data: this chat's copy (written by onTrackerEntry / setExtData), else the persona sheet.
            const data = subject.kind === 'user' ? (promptUser().ext?.[ext.id] ?? personaData().ext?.[ext.id]) : subject.template?.ext?.[ext.id];
            if (!data && !ext.sceneXmlAlways) continue;
            const scene = promptScene();
            const xml = ext.sceneXml({ ...subject, data, scene, sceneIds: [...scene.active] });
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
        inner.push(...outfitXml(u.outfit, p.wardrobe, !!u.dressed));
    }
    inner.push(...extXml({ kind: 'user', name: c.name1, subject: personaData(), user: promptUser() }));
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
    inner.push(...outfitXml(inst.outfit, t?.wardrobe, !!inst.dressed));
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
    // Sister extensions may rewrite the finished scene text (transformScene); without any it is returned as built.
    return String(pipe('transformScene', parts.join('\n'), { roster }) ?? '');
}
