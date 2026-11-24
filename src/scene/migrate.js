// Upgrade of chats saved by older versions: roster arrays → scenes { instances, active }, and no starting outfit on instances.
// Characters who had left are recovered from earlier messages, and each old entry gets its card fields
// copied from the template once (it becomes a full instance), after which the chat no longer reads the template.

import { MODULE } from '../constants.js';
import { ctx, hasChat, meta } from '../core/context.js';
import { lib } from '../core/settings.js';
import { instanceFromTemplate, isScene, toScene } from '../logic/instances.js';
import { instanceOpts, snapOf } from './roster.js';

/** A legacy roster entry ({id, name, posture, state, feelings, outfit}) as a full instance. */
function upgradeInstance(inst) {
    if (inst?.instanceOf) return inst;
    const t = lib()[inst.id];
    const base = t ? instanceFromTemplate(t, instanceOpts()) : { id: inst.id, name: inst.name ?? inst.id, wardrobe: [], instanceOf: inst.id };
    const out = { ...base, ...inst, instanceOf: base.instanceOf };
    delete out.defaultWorn;
    return out;
}

/** Legacy value → scene, with `known` (everyone met earlier in the chat) kept as inactive instances. */
function upgradeValue(value, known) {
    if (value === undefined || value === null) return value;
    if (isScene(value)) {
        for (const [id, inst] of Object.entries(value.instances)) {
            if (!inst?.instanceOf) value.instances[id] = upgradeInstance({ id, ...inst });
            else delete inst.defaultWorn; // instances made before starting outfits were template-only
        }
        return value;
    }
    const sc = toScene(value);
    const instances = {};
    for (const [id, inst] of Object.entries(known)) instances[id] = JSON.parse(JSON.stringify(inst));
    for (const [id, inst] of Object.entries(sc.instances)) instances[id] = upgradeInstance(inst);
    return { instances, active: sc.active };
}

/** Upgrade every stored scene of the open chat. Saves the chat when anything changed. */
export function migrateChatScenes() {
    if (!hasChat()) return false;
    const c = ctx();
    const m = meta();
    let changed = false;
    const known = {};
    const remember = (sc) => { if (isScene(sc)) for (const [id, inst] of Object.entries(sc.instances)) known[id] = inst; };
    const fix = (holder, key, carry) => {
        if (!holder) return;
        const v = holder[key];
        if (v === undefined || v === null || (isScene(v) && Object.values(v.instances).every(i => i?.instanceOf && !('defaultWorn' in i)))) return;
        holder[key] = upgradeValue(v, carry);
        changed = true;
    };
    if (m) { fix(m, 'base', {}); remember(m.base); }
    for (const msg of c.chat || []) {
        const carry = { ...known };
        const extras = [msg?.extra, ...(Array.isArray(msg?.swipe_info) ? msg.swipe_info.map(si => si?.extra) : [])];
        for (const extra of extras) {
            const sn = extra?.[MODULE];
            if (sn) { fix(sn, 'pre', carry); fix(sn, 'post', carry); }
        }
        remember(snapOf(msg)?.post);
    }
    if (changed) { c.saveMetadataDebounced?.(); c.saveChat?.(); }
    return changed;
}
