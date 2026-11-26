// Character fields added by sister extensions (registerExtension({ fields: [...] }), API 12).
//
// A field is one value on every NPC card, shown in one of the card's sections and sent to the LLM:
//   { name, place?, before?, after?, type?, prompt?, key?, placeholder?, instruction? }
//   name         label shown in the card editor ("Goals").
//   place        'root' (top block: ID, Name, Folder, Dialogue color; in the prompt: the <char> element's attributes),
//                'identity' (the Identity section; default) or 'profile' (the Profile section). Both go into <identity …/>.
//   before/after an existing field of that place to sit next to, e.g. { place: 'root', before: 'name' },
//                { place: 'profile', after: 'pronouns' }. Missing or unknown: the end of the section.
//   type         'string' (default), 'number' or 'boolean'.
//   prompt       the prompt-return name: the attribute the LLM sees and the key it writes back
//                (life-goal="to become a super star"). Default: `name` in lower case, spaces as "_".
//   key          storage key in ext[<extension id>]. Default: `prompt`.
// The value is stored on the card as ext[<extension id>][key], so it is copied into chats, rolls back with swipes and
// can be read / written with getExtData / setExtData like any other extension data.

import { extensions } from './runtime.js';
import { esc, xa } from './utils.js';

export const FIELD_PLACES = ['root', 'identity', 'profile'];
const FIELD_TYPES = ['string', 'number', 'boolean'];

/** Loose key comparison: "life-goal", "life_goal", "Life Goal" and "lifeGoal" are the same key. */
export const fieldKey = (k) => String(k ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** A safe XML attribute name from the prompt name. */
function attrName(s) {
    const n = String(s).trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_.-]/g, '_');
    return /^[A-Za-z_]/.test(n) ? n : `_${n}`;
}

/** Every registered field, normalized, in registration order. With `place`, only the fields of that place. */
export function customFields(place) {
    const out = [];
    for (const ext of extensions.values()) {
        for (const f of Array.isArray(ext?.fields) ? ext.fields : []) {
            if (!f?.name) continue;
            const prompt = attrName(f.prompt || String(f.name).toLowerCase());
            out.push({
                extId: ext.id,
                name: String(f.name),
                place: FIELD_PLACES.includes(f.place) ? f.place : 'identity',
                before: f.before ?? null,
                after: f.before == null ? (f.after ?? null) : null,
                type: FIELD_TYPES.includes(f.type) ? f.type : 'string',
                prompt,
                key: String(f.key || prompt),
                placeholder: String(f.placeholder ?? ''),
                instruction: String(f.instruction ?? ''),
            });
        }
    }
    return place ? out.filter(f => f.place === place) : out;
}

/** A field's stored value on a card or instance (or undefined). */
export function fieldValue(subject, f, ext = subject?.ext) {
    return ext?.[f.extId]?.[f.key];
}

/** A raw value (typed in the editor, or written by the LLM) as the field's type; undefined when it isn't one. */
export function coerceField(f, v) {
    if (v === undefined || v === null) return undefined;
    if (f.type === 'number') {
        if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
        const n = parseFloat(String(v));
        return Number.isFinite(n) ? n : undefined;
    }
    if (f.type === 'boolean') {
        if (typeof v === 'boolean') return v;
        const s = String(v).trim().toLowerCase();
        if (['true', 'yes', 'y', '1'].includes(s)) return true;
        if (['false', 'no', 'n', '0'].includes(s)) return false;
        return undefined;
    }
    return typeof v === 'object' ? undefined : String(v).trim();
}

/** Nothing to send: empty, or a boolean that isn't true. */
function isEmpty(f, v) {
    return v === undefined || v === null || v === '' || (f.type === 'boolean' && v !== true);
}

/**
 * Put fields among a section's items ([{ key, … }]) at their before/after anchors (unknown anchor: the end).
 * `make(f)` builds the field's item, or null to leave it out. Field items carry the field's prompt name as `key`,
 * so a field can also sit next to another extension's field.
 */
export function arrangeFields(items, fields, make) {
    const out = [...items];
    for (const f of fields) {
        const item = make(f);
        if (!item) continue;
        const anchor = f.before ?? f.after;
        const at = anchor == null ? -1 : out.findIndex(x => fieldKey(x.key) === fieldKey(anchor));
        if (at < 0) { out.push(item); continue; }
        if (f.before != null) { out.splice(at, 0, item); continue; }
        // Several fields after the same anchor keep their registration order.
        let i = at + 1;
        while (out[i]?.afterOf === fieldKey(anchor)) i++;
        out.splice(i, 0, { ...item, afterOf: fieldKey(anchor) });
    }
    return out;
}

/** Card-editor input for one field. */
export function fieldInputHtml(f, value) {
    const data = `data-ext="${esc(f.extId)}" data-key="${esc(f.key)}"`;
    if (f.type === 'boolean') {
        return `<label class="checkbox_label"><input type="checkbox" class="npcb-ed-xfield" ${data}${value === true ? ' checked' : ''}> ${esc(f.name)}</label>`;
    }
    const type = f.type === 'number' ? 'number' : 'text';
    return `<label>${esc(f.name)}<input type="${type}" class="text_pole npcb-ed-xfield" ${data} value="${esc(value ?? '')}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}></label>`;
}

/** Read every field input under `root` into `ext` (an ext object, changed in place). */
export function readFieldInputs(root, ext) {
    const fields = customFields();
    root.find('.npcb-ed-xfield').each((_, el) => {
        const f = fields.find(x => x.extId === el.dataset.ext && x.key === el.dataset.key);
        if (!f) return;
        const v = f.type === 'boolean' ? el.checked : coerceField(f, el.value);
        const cur = ext[f.extId];
        ext[f.extId] = { ...(cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {}), [f.key]: v === undefined ? '' : v };
    });
}

/** Prompt attributes for a section: base items [{ key, text }] with that place's fields arranged in. Returns the joined text. */
export function attrsWithFields(baseItems, subject, place) {
    return arrangeFields(baseItems, customFields(place), (f) => {
        const v = fieldValue(subject, f);
        return isEmpty(f, v) ? null : { key: f.prompt, text: ` ${f.prompt}="${xa(String(v))}"` };
    }).map(x => x.text).join('');
}

/** Find a key in an object loosely (see fieldKey). */
function pick(obj, name) {
    if (!obj || typeof obj !== 'object') return undefined;
    const k = Object.keys(obj).find(x => fieldKey(x) === fieldKey(name));
    return k === undefined ? undefined : obj[k];
}

/** Field values the LLM wrote in a tracker / greeting entry (top level or inside "traits"): { [extId]: { [key]: value } }. */
export function fieldsFromEntry(entry) {
    const out = {};
    for (const f of customFields()) {
        const v = coerceField(f, pick(entry, f.prompt) ?? pick(entry?.traits, f.prompt));
        if (v === undefined) continue;
        (out[f.extId] = out[f.extId] || {})[f.key] = v;
    }
    return out;
}

/** Merge field values into an ext object (changed in place). */
export function mergeFieldValues(ext, values) {
    for (const [extId, patch] of Object.entries(values)) {
        const cur = ext[extId];
        ext[extId] = { ...(cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {}), ...patch };
    }
    return ext;
}

/** Prompt names of fields placed in Identity (they join [[TRAIT_KEYS]]). */
export function identityFieldPrompts() {
    return customFields('identity').map(f => f.prompt);
}

/** Tracking-prompt line for root / profile fields (Identity fields are listed with the trait keys instead). */
export function fieldInstructions() {
    const fs = customFields().filter(f => f.place !== 'identity' || f.instruction);
    if (!fs.length) return '';
    const kind = { string: 'text', number: 'a number', boolean: 'true or false' };
    const parts = fs.map(f => f.instruction || `"${f.prompt}" (${kind[f.type]})`);
    return `Also give each character these fields (in their entry, when first known or when they change): ${parts.join('; ')}.`;
}
