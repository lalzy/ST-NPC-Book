// NPC Book — character-scoped NPC cards for SillyTavern.
// NPC details are injected ONLY while the NPC is present in the current chat's scene roster.

import {
    extractTracker, applyTracker, uniqueId, slugify, ID_PATTERN, normalize, pickEnum,
    extractCharacterList, resolveRef, normColor,
    SLOTS, STACKING_SLOTS, applyOutfitChange, outfitFromDefault, outfitBySlot, wearItem, findItem, normOutfitChange, inferSlots,
} from './logic.js';
import { promptManager } from '../../../openai.js';
import { user_avatar, getUserAvatar } from '../../../personas.js';

const MODULE = 'npc_book';
const EXT_FOLDER = new URL('.', import.meta.url).pathname;
const PM_SCENE_ID = 'npcbook_scene';
const PM_INSTR_ID = 'npcbook_instructions';
const INJECT_SCENE_KEY = 'npcbook_scene';
const INJECT_INSTR_KEY = 'npcbook_instructions';

const DEFAULT_INSTRUCTIONS = `[NPC Tracking]
At the very end of EVERY reply, output one <npcs> block listing every character who is physically present in the scene at the end of your reply, except [[EXCLUDE]].
- Characters who left the scene must be omitted. Characters who arrived must be added.
- If nobody is present, output <npcs>[]</npcs>.
- Reuse the exact "id" of a character already present, or listed under Known NPCs, ONLY if it is the same person (same identity: [[TRAIT_KEYS]]). Someone who merely shares a name is a different, NEW character.
- For a character that is not present and not listed, add "new": true plus "description" (one line) and "details" (full profile: appearance, personality, background, manner of speech).
- Always include "traits" with: [[TRAIT_KEYS]].
- "posture" must be one of: [[POSTURES]]
- "state" must be one of: [[STATES]]
- "feelings" is the character's private inner thoughts right now (1-2 sentences).
[[COLOR_RULE]]
[[OUTFIT_RULES]]

Format:
<npcs>
[
  {"id": "existing_id", "name": "Name", "traits": {[[TRAIT_EXAMPLE]]}, "posture": "...", "state": "...", "feelings": "...", "outfit": {"wear": ["item_id"], "remove": ["item_id"]}}[[USER_EXAMPLE]]
]
</npcs>

Known NPCs (id: name — identity):
[[LIBRARY]]`;

const DEFAULT_OUTFIT_RULES = `Clothing:
- Each character may ONLY wear items from their own Wardrobe (listed with the scene). Never invent clothing for a character who has a wardrobe.
- When someone's clothing changes, add "outfit": {"wear": ["item_id"], "remove": ["item_id"], "condition": {"item_id": "<condition>"}}. Leave "outfit" out when nothing changed. Putting an item on replaces whatever already occupies the same body slots.
- Pick clothing that fits the situation (e.g. sleepwear for bed, then a day outfit after waking).
- "condition" must be one of: [[CONDITIONS]]
- For a NEW character also add "wardrobe": 4-8 items that fit them, as [{"name": "...", "slots": ["..."]}], and "outfit": {"wear": ["item name", ...]} for what they wear right now. Slots: [[SLOTS]]`;

const DEFAULT_COLOR_RULE = `Dialogue colors:
- In your reply (outside the <npcs> block), wrap every line of spoken dialogue in <font color=HEX>"..."</font> using the speaking character's Dialogue color from the scene, e.g. <font color=#e6a0c4>"Hello there."</font>
- Use the exact color listed for that character. Characters without a Dialogue color get no font tag.`;

const DEFAULT_PORTRAIT_LLM_PROMPT = `Describe {{name}} for an image generator. Use the template below.

STEP 1 – Fill every field in your reasoning.
Source for each field: the CHARACTER DATA and LATEST STORY MESSAGES provided below only.
If a field is not stated in the sources, write NONE. Never guess.

TEMPLATE
GENDER_TAG: 1girl or 1boy
SPECIES: e.g. human, elf
AGE: number + "years old"
HEIGHT: short / average height / tall
FIGURE: 1 to 2 of: slender, petite, athletic, curvy, hourglass, heavy, wide hips, narrow waist
BUST: small bust / medium bust / large bust (female only)
SKIN: color + "skin"
HAIR: length + color + "hair"
HAIRSTYLE: e.g. ponytail, loose, bun
EYES: color + "eyes"
CLOTHING: every item worn right now, each as color + material + item. If nude, write "nude".
ACCESSORIES: glasses, jewelry, hats etc. worn right now
EXPRESSION: one word
POSE: standing / sitting / leaning / kneeling / lying down
SETTING: 1 to 3 words

STEP 2 – Check every field.
- Is it stated in the sources? If not, change it to NONE.
- Does it follow the field's format? If not, fix it.
- Is it a literal visual word? No metaphors, no names, no personality, no actions.

STEP 3 – Output.
Join the fields in template order with ", ".
Remove every NONE field.
Start the line with "solo, upper body, portrait, close-up, ".
Output only that line.`;

const COLOR_PALETTE = ['#e6a0c4', '#8ecae6', '#f4a261', '#90be6d', '#c77dff', '#ffd166', '#ef476f', '#06d6a0', '#a0c4ff', '#ffadad', '#bdb2ff', '#caffbf', '#f28482', '#84a59d', '#e9c46a', '#9bf6ff'];
const HEX_RE = /^#[0-9a-f]{6}$/i;

function pickColor() {
    const used = new Set(Object.values(lib()).map(t => String(t.color || '').toLowerCase()));
    const free = COLOR_PALETTE.filter(c => !used.has(c));
    const pool = free.length ? free : COLOR_PALETTE;
    return pool[Math.floor(Math.random() * pool.length)];
}

const DEFAULT_USER_RULE = `- Also add ONE entry {"id": "user", "posture": "..."} for [[USER]] (posture from the list above). Add "outfit" to it only when [[USER]]'s clothing changes, using items from [[USER]]'s Wardrobe. Never give [[USER]] a state or feelings.`;

const DEFAULTS = {
    enabled: true,
    injectMode: 'pm', // 'pm' = Prompt Manager entries / macros, 'auto' = extension prompt with depth
    scenePosition: 1, sceneDepth: 2, sceneRole: 0,
    instrPosition: 1, instrDepth: 0, instrRole: 0,
    instructions: DEFAULT_INSTRUCTIONS,
    sceneHeader: '[NPCs present in the scene]',
    includeLibrary: true,
    threshold: 50,
    numericTolerance: 2,
    autoCreate: true,
    trackChar: true,
    traitKeys: ['age', 'gender', 'role'],
    postures: ['Standing', 'Sitting', 'Lying down', 'Kneeling', 'Crouching', 'Leaning', 'Walking', 'Running'],
    states: ['Calm', 'Happy', 'Excited', 'Curious', 'Nervous', 'Afraid', 'Angry', 'Sad', 'Tired', 'Injured', 'Asleep', 'Unconscious'],
    rosterCollapsed: false,
    trackUser: true,
    speakerPortraits: true,
    speakerPortraitSize: 56,
    autoPortraits: true,
    portraitPrompt: 'portrait of {{name}}, head and shoulders, {{traits}}, {{details}}',
    portraitMode: 'llm',
    portraitLlmPrompt: DEFAULT_PORTRAIT_LLM_PROMPT,
    dialogueColors: true,
    colorRule: DEFAULT_COLOR_RULE,
    trackOutfits: true,
    includeWardrobe: true,
    allowWardrobeGrowth: false,
    outfitRules: DEFAULT_OUTFIT_RULES,
    conditions: ['Worn', 'Loosened', 'Disheveled', 'Wet', 'Dirty', 'Bloody', 'Torn'],
    personas: {},
    library: {},
};

let genCtx = null; // { type, pre, targetIdx }
let processing = false;

// ───────────────────────── helpers ─────────────────────────

const ctx = () => SillyTavern.getContext();

function settings() {
    const es = ctx().extensionSettings;
    if (!es[MODULE]) es[MODULE] = structuredClone(DEFAULTS);
    const s = es[MODULE];
    for (const [k, v] of Object.entries(DEFAULTS)) if (s[k] === undefined) s[k] = structuredClone(v);
    if (typeof s.instructions === 'string' && s.instructions.includes('except [[USER]] and [[CHAR]]')) {
        s.instructions = s.instructions.replace('except [[USER]] and [[CHAR]]', 'except [[EXCLUDE]]');
    }
    if (typeof s.instructions === 'string' && !s.instructions.includes('[[OUTFIT_RULES]]') && s.instructions.includes('\nFormat:\n')) {
        s.instructions = s.instructions.replace('\nFormat:\n', '[[OUTFIT_RULES]]\n\nFormat:\n');
    }
    if (typeof s.instructions === 'string' && !s.instructions.includes('[[COLOR_RULE]]')) {
        if (s.instructions.includes('[[OUTFIT_RULES]]')) s.instructions = s.instructions.replace('[[OUTFIT_RULES]]', '[[COLOR_RULE]]\n[[OUTFIT_RULES]]');
        else s.instructions += '\n[[COLOR_RULE]]';
    }
    if (typeof s.instructions === 'string' && !s.instructions.includes('[[USER_EXAMPLE]]')) {
        s.instructions = s.instructions.replace('"feelings": "..."}\n]', '"feelings": "...", "outfit": {"wear": ["item_id"], "remove": ["item_id"]}}[[USER_EXAMPLE]]\n]');
    }
    return s;
}
const save = () => ctx().saveSettingsDebounced();
const lib = () => settings().library;

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
}

function meta() {
    const m = ctx().chatMetadata;
    if (!m) return null;
    if (!m[MODULE] || typeof m[MODULE] !== 'object') m[MODULE] = { base: [], pre: null };
    return m[MODULE];
}

function hasChat() {
    const c = ctx();
    // Works for saved chats, group chats AND Assistant / temporary chats (which have no chat id).
    return Array.isArray(c.chat) && (!!c.getCurrentChatId?.() || c.characterId !== undefined || !!c.groupId || c.chat.length > 0);
}

/** Names the LLM must not list. The main character is tracked unless disabled (or in Assistant mode). */
function excludedNames() {
    const c = ctx();
    const assistantMode = c.characterId === undefined && !c.groupId;
    const out = [c.name1];
    if (!settings().trackChar || assistantMode) out.push(c.name2);
    return out.filter(Boolean);
}

function clone(x) { return JSON.parse(JSON.stringify(x ?? null)); }

function sig(text) {
    let h = 0;
    const str = String(text ?? '');
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return `${str.length}:${h}`;
}

function snapOf(msg) { return msg?.extra?.[MODULE] ?? null; }

/** Roster as of the end of the chat (latest message snapshot, else chat base). */
function currentRoster() {
    const chat = ctx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        const s = snapOf(chat[i]);
        if (s && Array.isArray(s.post)) return s.post;
    }
    return meta()?.base ?? [];
}

function rosterBefore(idx) {
    const chat = ctx().chat || [];
    for (let i = Math.min(idx, chat.length) - 1; i >= 0; i--) {
        const s = snapOf(chat[i]);
        if (s && Array.isArray(s.post)) return s.post;
    }
    return meta()?.base ?? [];
}

// ── persona ("user") state ──
function personaKey() { return user_avatar || ''; }
function personaData(key = personaKey()) {
    const s = settings();
    if (!s.personas[key]) s.personas[key] = { wardrobe: [], defaultWorn: [] };
    const p = s.personas[key];
    p.wardrobe = p.wardrobe || [];
    p.defaultWorn = p.defaultWorn || [];
    return p;
}
function freshUser(prev) {
    const s = settings();
    const p = personaData();
    return { persona: personaKey(), posture: prev?.posture ?? s.postures[0] ?? '', outfit: outfitFromDefault(p.defaultWorn, p.wardrobe, s.conditions) };
}
function adaptUser(u) {
    if (!u || u.persona !== personaKey()) return freshUser(u);
    return u;
}
function currentUser() {
    const chat = ctx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        const sn = snapOf(chat[i]);
        if (sn?.postUser) return adaptUser(sn.postUser);
    }
    return adaptUser(meta()?.baseUser);
}
function userBefore(idx) {
    const chat = ctx().chat || [];
    for (let i = Math.min(idx, chat.length) - 1; i >= 0; i--) {
        const sn = snapOf(chat[i]);
        if (sn?.postUser) return adaptUser(sn.postUser);
    }
    return adaptUser(meta()?.baseUser);
}
function promptUser() {
    if (genCtx?.preUser && genCtx.idx === undefined) return adaptUser(genCtx.preUser);
    return currentUser();
}

/** Roster the prompt should use for the generation in progress. */
function promptRoster() {
    if (genCtx?.pre && genCtx.idx === undefined) return genCtx.pre;
    return currentRoster();
}

/** Write a roster into the snapshot of the last message (all swipes), so manual edits survive swiping. */
function writeCurrentRoster(roster, user) {
    if (roster === null) roster = currentRoster();
    if (user === undefined) user = currentUser();
    const c = ctx();
    const chat = c.chat || [];
    const m = meta();
    if (!m) return;
    if (!chat.length) {
        m.base = clone(roster);
        m.baseUser = clone(user);
    } else {
        const idx = chat.length - 1;
        const msg = chat[idx];
        const apply = (extra) => {
            const s = extra[MODULE] ?? (extra[MODULE] = {});
            s.post = clone(roster);
            s.postUser = clone(user);
            if (!msg.is_user) { s.pre = clone(roster); s.preUser = clone(user); }
        };
        msg.extra = msg.extra || {};
        apply(msg.extra);
        if (Array.isArray(msg.swipe_info)) for (const si of msg.swipe_info) { if (si) { si.extra = si.extra || {}; apply(si.extra); } }
        if (!msg.is_user) m.pre = { idx, roster: clone(roster), user: clone(user) };
    }
    c.saveMetadataDebounced?.();
    c.saveChat?.();
    renderRoster();
}

function templateFor(inst) { return lib()[inst.id] || null; }

function portraitUrl(t) { return t?.portrait || ''; }

function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
}

function avatarHtml(t, name, cls = '') {
    const url = portraitUrl(t);
    return url
        ? `<img class="npcb-ava ${cls}" src="${esc(url)}" alt="${esc(name)}" draggable="false">`
        : `<div class="npcb-ava npcb-ava-fallback ${cls}">${esc(initials(name))}</div>`;
}

function traitSummary(t) {
    const tr = t?.traits || {};
    return settings().traitKeys.map(k => tr[k]).filter(v => v && String(v).trim()).join(', ');
}

// ───────────────────────── prompt text ─────────────────────────

const SLOT_LABEL = Object.fromEntries(SLOTS.map(x => [x.key, x.label]));

function wearingLine(outfit, wardrobe) {
    const s = settings();
    const def = s.conditions[0];
    const parts = (outfit || []).map(w => {
        const it = findItem(wardrobe, w.id);
        if (!it) return null;
        const cond = w.condition && w.condition !== def ? ` (${w.condition})` : '';
        return `${it.slots.map(k => SLOT_LABEL[k] || k).join(' + ')}: ${it.name}${cond}`;
    }).filter(Boolean);
    return `Wearing: ${parts.length ? parts.join('; ') : 'nothing'}`;
}

function wardrobeLine(wardrobe) {
    if (!wardrobe?.length) return '';
    return `Wardrobe: ${wardrobe.map(i => `${i.id} = ${i.name} [${i.slots.map(k => SLOT_LABEL[k] || k).join(', ')}]`).join('; ')}`;
}

function outfitLines(outfit, wardrobe) {
    const s = settings();
    if (!s.trackOutfits) return [];
    if (!wardrobe?.length && !(outfit || []).length) return [];
    const out = [wearingLine(outfit, wardrobe)];
    if (s.includeWardrobe) { const wl = wardrobeLine(wardrobe); if (wl) out.push(wl); }
    return out;
}

function buildUserBlock() {
    const s = settings();
    if (!s.trackUser) return '';
    const c = ctx();
    const u = promptUser();
    const p = personaData();
    const lines = [`<user name="${c.name1}">`];
    if (u.posture) lines.push(`Posture: ${u.posture}`);
    lines.push(...outfitLines(u.outfit, p.wardrobe));
    lines.push('</user>');
    return lines.join('\n');
}

function buildSceneText() {
    const s = settings();
    if (!s.enabled || !hasChat()) return '';
    const roster = promptRoster();
    const userBlock = buildUserBlock();
    if (!roster.length && !userBlock) return '';
    const blocks = roster.map(inst => {
        const t = templateFor(inst);
        const name = t?.name ?? inst.name ?? inst.id;
        const details = (t?.details ?? '').trim();
        const lines = [`<npc id="${inst.id}" name="${name}">`];
        if (details) lines.push(details);
        const ps = [inst.posture && `Posture: ${inst.posture}`, inst.state && `State: ${inst.state}`].filter(Boolean).join(' | ');
        if (ps) lines.push(ps);
        if (s.dialogueColors && HEX_RE.test(t?.color || '')) lines.push(`Dialogue color: ${t.color}`);
        if (inst.feelings) lines.push(`Inner feelings: ${inst.feelings}`);
        lines.push(...outfitLines(inst.outfit, t?.wardrobe));
        lines.push('</npc>');
        return lines.join('\n');
    });
    return [s.sceneHeader, userBlock, ...blocks].filter(Boolean).join('\n');
}

function buildInstructionText() {
    const s = settings();
    if (!s.enabled || !hasChat()) return '';
    const c = ctx();
    const keys = s.traitKeys.length ? s.traitKeys : ['age', 'gender', 'role'];
    const libLines = s.includeLibrary
        ? Object.values(lib()).sort((a, b) => a.name.localeCompare(b.name)).map(t => {
            const tr = traitSummary(t);
            return `${t.id}: ${t.name}${tr ? ` — ${tr}` : ''}`;
        })
        : [];
    return String(s.instructions || '')
        .replaceAll('[[COLOR_RULE]]', s.dialogueColors ? s.colorRule : '')
        .replaceAll('[[OUTFIT_RULES]]', [s.trackOutfits ? s.outfitRules : '', s.trackUser ? DEFAULT_USER_RULE : ''].filter(Boolean).join('\n'))
        .replaceAll('[[USER_EXAMPLE]]', s.trackUser ? ',\n  {"id": "user", "posture": "..."}' : '')
        .replaceAll('[[CONDITIONS]]', s.conditions.join(', '))
        .replaceAll('[[SLOTS]]', SLOTS.map(x => x.key).join(', '))
        .replaceAll('[[EXCLUDE]]', excludedNames().join(' and ') || 'the user')
        .replaceAll('[[USER]]', c.name1 || 'the user')
        .replaceAll('[[CHAR]]', c.name2 || 'the main character')
        .replaceAll('[[POSTURES]]', s.postures.join(', '))
        .replaceAll('[[STATES]]', s.states.join(', '))
        .replaceAll('[[TRAIT_KEYS]]', keys.join(', '))
        .replaceAll('[[TRAIT_EXAMPLE]]', keys.map(k => `"${k}": "..."`).join(', '))
        .replaceAll('[[LIBRARY]]', libLines.length ? libLines.join('\n') : '(none yet)');
}

function updateAutoInjection() {
    const c = ctx();
    const s = settings();
    const auto = s.enabled && s.injectMode === 'auto';
    c.setExtensionPrompt(INJECT_SCENE_KEY, auto ? buildSceneText() : '', Number(s.scenePosition), Number(s.sceneDepth), false, Number(s.sceneRole));
    c.setExtensionPrompt(INJECT_INSTR_KEY, auto ? buildInstructionText() : '', Number(s.instrPosition), Number(s.instrDepth), false, Number(s.instrRole));
}

function registerMacros() {
    const c = ctx();
    const defs = [
        ['npcScene', 'NPC Book: details + live state of NPCs present in this chat (empty if none).', buildSceneText],
        ['npcInstructions', 'NPC Book: tracking instructions for the LLM.', buildInstructionText],
    ];
    for (const [name, description, fn] of defs) {
        try {
            if (c.macros?.register) c.macros.register(name, { category: 'NPC Book', description, handler: () => fn() });
            else c.registerMacro(name, () => fn(), description);
        } catch (e) {
            try { c.registerMacro(name, () => fn(), description); } catch (e2) { console.error('[NPC Book] macro registration failed', e2); }
        }
    }
}

// ───────────────────────── Prompt Manager ─────────────────────────

function pmReady() {
    return !!(promptManager && promptManager.serviceSettings && promptManager.activeCharacter);
}

function pmStatus() {
    if (!pmReady()) return null;
    const res = {};
    for (const id of [PM_SCENE_ID, PM_INSTR_ID]) {
        const exists = !!promptManager.getPromptById(id);
        const entry = promptManager.getPromptOrderEntry(promptManager.activeCharacter, id);
        res[id] = { exists, placed: !!entry, enabled: !!entry?.enabled };
    }
    return res;
}

async function installPmEntries() {
    if (!pmReady()) {
        toastr.warning('Prompt Manager is not active. Switch to a Chat Completion API and open the AI Response Configuration panel once, then try again.', 'NPC Book');
        return;
    }
    const st0 = pmStatus();
    const pmStatusBefore = st0 && (st0[PM_INSTR_ID].placed || st0[PM_SCENE_ID].placed);
    const defs = [
        { id: PM_INSTR_ID, name: 'NPC Book — Instructions', content: '{{npcInstructions}}', injection_position: 0, injection_depth: 4 },
        { id: PM_SCENE_ID, name: 'NPC Book — Present NPCs', content: '{{npcScene}}', injection_position: 0, injection_depth: 4 },
    ];
    for (const d of defs) {
        if (!promptManager.getPromptById(d.id)) {
            promptManager.addPrompt({
                name: d.name, role: 'system', content: d.content, system_prompt: false, marker: false,
                injection_position: d.injection_position, injection_depth: d.injection_depth, injection_order: 100, forbid_overrides: false,
            }, d.id);
        }
        const prompt = promptManager.getPromptById(d.id);
        promptManager.appendPrompt(prompt, promptManager.activeCharacter);
        const entry = promptManager.getPromptOrderEntry(promptManager.activeCharacter, d.id);
        if (entry) entry.enabled = true;
    }
    // Default placement: just before Chat History (user can drag them anywhere afterwards).
    const order = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter);
    const ours = order.filter(e => e.identifier === PM_INSTR_ID || e.identifier === PM_SCENE_ID);
    if (ours.length && !pmStatusBefore) {
        for (const e of ours) order.splice(order.indexOf(e), 1);
        const at = order.findIndex(e => e.identifier === 'chatHistory');
        ours.sort((a, b) => (a.identifier === PM_INSTR_ID ? -1 : 1) - (b.identifier === PM_INSTR_ID ? -1 : 1));
        order.splice(at >= 0 ? at : order.length, 0, ...ours);
    }
    promptManager.render?.();
    await promptManager.saveServiceSettings?.();
    toastr.success('Added "NPC Book — Instructions" and "NPC Book — Present NPCs" to the Prompt Manager. Drag them where you want; edit each to set role, position (relative / in-chat) and depth.', 'NPC Book', { timeOut: 8000 });
    renderPmStatus();
}

function renderPmStatus() {
    const el = $('#npcb_pm_status');
    if (!el.length) return;
    const st = pmStatus();
    if (!st) { el.html('<span class="npcb-warn">Prompt Manager not active (Chat Completion only). With Text Completion, put <code>{{npcInstructions}}</code> and <code>{{npcScene}}</code> in your Story String, or use Auto inject.</span>'); return; }
    const row = (label, x) => `${label}: ${x.exists ? (x.placed ? (x.enabled ? '<b class="npcb-ok">placed &amp; enabled</b>' : '<b class="npcb-warn">placed but disabled</b>') : '<b class="npcb-warn">not in prompt order</b>') : '<b class="npcb-warn">missing</b>'}`;
    el.html(`${row('Instructions', st[PM_INSTR_ID])}<br>${row('Present NPCs', st[PM_SCENE_ID])}`);
}

// ───────────────────────── generation hooks ─────────────────────────

function onGenerationStarted(type, _opts, dryRun) {
    if (dryRun) { updateAutoInjection(); return; }
    const chat = ctx().chat || [];
    if (type === 'quiet' || type === 'impersonate') { updateAutoInjection(); return; }
    const lastIdx = chat.length - 1;
    const last = chat[lastIdx];
    if ((type === 'swipe' || type === 'continue') && last && !last.is_user) {
        const m = meta();
        const metaHit = m?.pre && m.pre.idx === lastIdx;
        const pre = metaHit ? m.pre.roster : (snapOf(last)?.pre ?? rosterBefore(lastIdx));
        const preUser = (metaHit && m.pre.user) ? m.pre.user : (snapOf(last)?.preUser ?? userBefore(lastIdx));
        genCtx = { type, pre: clone(pre), preUser: clone(adaptUser(preUser)), targetIdx: lastIdx };
    } else {
        genCtx = { type, pre: clone(currentRoster()), preUser: clone(currentUser()), targetIdx: null };
    }
    updateAutoInjection();
}

async function processLastMessage() {
    const s = settings();
    if (!s.enabled || processing || !genCtx) return;
    const c = ctx();
    const chat = c.chat || [];
    const idx = chat.length - 1;
    const msg = chat[idx];
    if (!msg || msg.is_user || msg.is_system) return;
    const g = genCtx;
    if (g.idx !== undefined && g.idx !== idx) { genCtx = null; return; } // stale: belongs to an earlier message
    const existing = snapOf(msg);
    const exPeek = extractTracker(msg.mes);
    if (!exPeek.found && existing && existing.sig === sig(msg.mes)) return; // already processed
    processing = true;
    try {
        const ex = exPeek;
        const pre = g.pre ?? rosterBefore(idx);
        const preUser = adaptUser(g.preUser ?? userBefore(idx));
        let post = (g.type === 'continue' && existing?.post) ? existing.post : pre;
        let postUser = (g.type === 'continue' && existing?.postUser) ? adaptUser(existing.postUser) : preUser;
        if (ex.found) {
            msg.mes = ex.cleaned;
            if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined) msg.swipes[msg.swipe_id] = ex.cleaned;
            if (ex.json) {
                const excludeNames = excludedNames();
                const isUserEntry = (e) => e && typeof e === 'object' && (String(e.id ?? '').toLowerCase() === 'user' || (c.name1 && normalize(e.name) === normalize(c.name1)));
                const userEntry = ex.json.find(isUserEntry);
                if (userEntry && s.trackUser) {
                    const p = personaData();
                    const u = clone(postUser);
                    u.posture = pickEnum(userEntry.posture, s.postures, u.posture);
                    if (s.trackOutfits) {
                        const oc = applyOutfitChange(u.outfit, p.wardrobe, normOutfitChange(userEntry), s.conditions);
                        u.outfit = oc.outfit;
                        if (oc.rejected.length) console.debug('[NPC Book] user outfit items not in wardrobe:', oc.rejected);
                    }
                    postUser = u;
                }
                const r = applyTracker(ex.json.filter(e => !isUserEntry(e)), pre, {
                    library: lib(),
                    threshold: s.threshold / 100,
                    numericTolerance: s.numericTolerance,
                    postures: s.postures,
                    states: s.states,
                    conditions: s.conditions,
                    allowWardrobeGrowth: s.allowWardrobeGrowth,
                    autoCreate: s.autoCreate,
                    traitKeys: s.traitKeys,
                    excludeNames,
                });
                for (const t of r.created) { t.color = t.color || pickColor(); lib()[t.id] = t; }
                for (const t of r.updated || []) lib()[t.id] = t;
                if (r.updated?.length) save();
                if (r.created.length) {
                    save();
                    toastr.info(`New NPC${r.created.length > 1 ? 's' : ''}: ${r.created.map(t => `${t.name} (${t.id})`).join(', ')}`, 'NPC Book');
                    renderLibraryList();
                }
                post = r.roster;
                console.debug('[NPC Book] tracker', r.log);
            } else {
                console.warn('[NPC Book] could not parse tracker block:', ex.error, ex.raw);
                toastr.warning('Could not parse the <npcs> block; scene left unchanged.', 'NPC Book');
            }
        }
        const snap = { pre: clone(pre), post: clone(post), preUser: clone(preUser), postUser: clone(postUser), raw: ex.found ? ex.raw : (existing?.raw ?? null), sig: sig(msg.mes) };
        msg.extra = msg.extra || {};
        msg.extra[MODULE] = snap;
        if (Array.isArray(msg.swipe_info) && msg.swipe_id !== undefined) {
            msg.swipe_info[msg.swipe_id] = msg.swipe_info[msg.swipe_id] || {};
            msg.swipe_info[msg.swipe_id].extra = msg.swipe_info[msg.swipe_id].extra || {};
            msg.swipe_info[msg.swipe_id].extra[MODULE] = clone(snap);
        }
        const m = meta();
        if (m) m.pre = { idx, roster: clone(pre), user: clone(preUser) };
        g.idx = idx;
        await c.saveChat();
        c.saveMetadataDebounced?.();
        if (ex.found) { try { c.updateMessageBlock(idx, msg); } catch (e) { console.warn('[NPC Book] re-render failed', e); } }
    } catch (e) {
        console.error('[NPC Book] processing failed', e);
    } finally {
        processing = false;
        renderRoster();
    }
}

// ───────────────────────── first message: starting cast ─────────────────────────

/** Reads a `characters[ id, id ]` block from the greeting(s) at the start of the chat and puts them in the scene. */
async function processGreetings() {
    const s = settings();
    if (!s.enabled || !hasChat()) return;
    const c = ctx();
    const chat = c.chat || [];
    let changed = false;
    let carried = meta()?.base ?? [];
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (msg.is_user) break;
        if (msg.is_system) continue;
        const texts = Array.isArray(msg.swipes) && msg.swipes.length ? msg.swipes : [msg.mes];
        const cur = msg.swipe_id ?? 0;
        let msgChanged = false;
        for (let k = 0; k < texts.length; k++) {
            const ex = extractCharacterList(texts[k]);
            if (!ex.found) continue;
            const roster = clone(carried);
            const missing = [];
            for (const ref of ex.refs) {
                const id = resolveRef(ref, lib());
                if (!id) { missing.push(ref); continue; }
                if (roster.some(x => x.id === id)) continue;
                const t = lib()[id];
                roster.push({ id, name: t.name, posture: s.postures[0] ?? '', state: s.states[0] ?? '', feelings: '', outfit: outfitFromDefault(t.defaultWorn, t.wardrobe || [], s.conditions) });
            }
            if (missing.length) toastr.warning(`Not in the NPC Library: ${missing.join(', ')}`, 'NPC Book');
            const user = currentUser();
            const snap = { pre: clone(carried), post: clone(roster), preUser: clone(user), postUser: clone(user), raw: null, sig: sig(ex.cleaned), greeting: true };
            if (Array.isArray(msg.swipes) && msg.swipes.length) msg.swipes[k] = ex.cleaned;
            if (Array.isArray(msg.swipe_info)) {
                msg.swipe_info[k] = msg.swipe_info[k] || {};
                msg.swipe_info[k].extra = msg.swipe_info[k].extra || {};
                msg.swipe_info[k].extra[MODULE] = clone(snap);
            }
            if (k === cur) {
                msg.mes = ex.cleaned;
                msg.extra = msg.extra || {};
                msg.extra[MODULE] = snap;
            }
            msgChanged = true;
        }
        if (msgChanged) {
            changed = true;
            try { c.updateMessageBlock(i, msg); } catch (e) { /* not rendered yet */ }
        }
        const sn = snapOf(msg);
        if (sn?.post) carried = sn.post;
    }
    if (changed) {
        await c.saveChat?.();
        renderRoster();
        decorateAll();
    }
}

// ───────────────────────── portraits ─────────────────────────

const portraitTried = new Set();
let portraitBusy = false;
const portraitQueue = [];

function imageGenAvailable() {
    const c = ctx();
    const disabled = c.extensionSettings?.disabledExtensions || [];
    if (disabled.includes('stable-diffusion')) return false;
    return !!c.SlashCommandParser?.commands?.imagine;
}

function cleanForImagine(x) {
    return String(x ?? '').replace(/[|{}"\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Data about an NPC for portrait prompts: details, identity, what they wear right now, posture/state. */
function portraitData(t) {
    const s = settings();
    const inst = hasChat() ? currentRoster().find(i => i.id === t.id) : null;
    const outfit = inst?.outfit ?? outfitFromDefault(t.defaultWorn, t.wardrobe || [], s.conditions);
    const wearing = (outfit || []).map(w => {
        const it = findItem(t.wardrobe || [], w.id);
        if (!it) return null;
        return `${it.name}${w.condition && w.condition !== s.conditions[0] ? ` (${w.condition})` : ''}`;
    }).filter(Boolean).join(', ');
    return {
        name: t.name,
        traits: traitSummary(t),
        details: String(t.details || '').trim(),
        outfit: wearing || (t.wardrobe?.length ? 'nothing' : ''),
        posture: inst?.posture || '',
        state: inst?.state || '',
    };
}

function fillPortraitTemplate(tpl, d) {
    return String(tpl || '')
        .replaceAll('{{name}}', d.name)
        .replaceAll('{{char}}', d.name)
        .replaceAll('{{traits}}', d.traits)
        .replaceAll('{{details}}', d.details)
        .replaceAll('{{outfit}}', d.outfit)
        .replaceAll('{{posture}}', d.posture)
        .replaceAll('{{state}}', d.state);
}

function recentStory(n = 4, max = 2500) {
    const chat = ctx().chat || [];
    const out = [];
    for (let i = chat.length - 1; i >= 0 && out.length < n; i--) {
        const m = chat[i];
        if (!m || m.is_system) continue;
        out.unshift(`${m.name}: ${String(m.mes || '').replace(/<[^>]+>/g, '')}`);
    }
    const txt = out.join('\n\n');
    return txt.length > max ? txt.slice(txt.length - max) : txt;
}

/** Turn the LLM's answer into a single tag line (drop reasoning, quotes, labels). */
function extractTagLine(text) {
    let t = String(text ?? '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```[a-z]*|```/gi, '');
    const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const tagged = lines.filter(l => /^(solo|1girl|1boy|portrait)\b/i.test(l.replace(/^["'*\s]+/, '')));
    let line = (tagged.length ? tagged[tagged.length - 1] : lines[lines.length - 1]) || '';
    line = line.replace(/^(output|final|prompt|answer)\s*:\s*/i, '').replace(/^["'`*]+|["'`*]+$/g, '').trim();
    return line;
}

async function portraitPromptFor(t) {
    const s = settings();
    const d = portraitData(t);
    if (s.portraitMode !== 'llm') return cleanForImagine(fillPortraitTemplate(s.portraitPrompt, { ...d, details: d.details.slice(0, 400) }));
    const system = fillPortraitTemplate(s.portraitLlmPrompt, d);
    const data = [
        'CHARACTER DATA',
        `Name: ${d.name}`,
        d.traits && `Identity: ${d.traits}`,
        d.details && `Description: ${d.details}`,
        d.outfit && `Wearing right now: ${d.outfit}`,
        d.posture && `Posture: ${d.posture}`,
        d.state && `State: ${d.state}`,
        '',
        'LATEST STORY MESSAGES',
        recentStory() || '(none)',
    ].filter(x => typeof x === 'string').join('\n');
    const answer = await ctx().generateRaw({ systemPrompt: system, prompt: `${data}\n\nFollow the instructions and output only the final line.` });
    const line = cleanForImagine(extractTagLine(answer));
    console.debug('[NPC Book] portrait prompt for', t.id, '→', line);
    return line;
}

/** Queue an image-generation run for an NPC without a portrait (only if the Image Generation extension is active). */
function ensurePortrait(id, { force = false } = {}) {
    const s = settings();
    const t = lib()[id];
    if (!t || (t.portrait && !force)) return;
    if (!force && (!s.autoPortraits || portraitTried.has(id))) return;
    if (!imageGenAvailable()) { if (force) toastr.warning('Image Generation extension is not active.', 'NPC Book'); return; }
    portraitTried.add(id);
    if (!portraitQueue.some(q => q.id === id)) portraitQueue.push({ id, force });
    runPortraitQueue();
}

async function runPortraitQueue() {
    if (portraitBusy) return;
    portraitBusy = true;
    try {
        while (portraitQueue.length) {
            const { id, force } = portraitQueue.shift();
            const t = lib()[id];
            if (!t || (t.portrait && !force)) continue;
            try {
                const prompt = await portraitPromptFor(t);
                if (!prompt) { toastr.warning(`Could not build a portrait prompt for ${t.name}.`, 'NPC Book'); continue; }
                const res = await ctx().executeSlashCommandsWithOptions(`/imagine quiet=true gallery=false extend=false edit=false "${prompt}"`, { handleParserErrors: false, handleExecutionErrors: false });
                const url = String(res?.pipe ?? '').trim();
                if (url && lib()[id]) {
                    lib()[id].portrait = url.startsWith('/') || url.startsWith('data:') || url.startsWith('http') ? url : `/${url}`;
                    save();
                    renderRoster();
                    renderLibraryList();
                    decorateAll();
                    if (libSelected === id && !libIsNew) $('#npcb_library .npcb-ed-portrait').html(avatarHtml(lib()[id], lib()[id].name, 'npcb-ava-lg'));
                }
            } catch (e) {
                console.warn('[NPC Book] portrait generation failed', e);
                if (force) toastr.error(`Portrait generation failed: ${e?.message || e}`, 'NPC Book');
            }
        }
    } finally {
        portraitBusy = false;
    }
}

// ───────────────────────── speaker portraits in messages ─────────────────────────

/** Map dialogue colour -> NPC id, preferring characters present at that message. */
function colorMap(presentIds) {
    const map = new Map();
    const all = Object.values(lib()).filter(t => normColor(t.color));
    all.sort((a, b) => (presentIds.includes(b.id) - presentIds.includes(a.id)));
    for (const t of all) { const k = normColor(t.color); if (!map.has(k)) map.set(k, t.id); }
    return map;
}

function rosterAtMessage(idx) {
    const chat = ctx().chat || [];
    for (let i = Math.min(idx, chat.length - 1); i >= 0; i--) {
        const sn = snapOf(chat[i]);
        if (sn && Array.isArray(sn.post)) return i === idx && sn.pre ? [...new Set([...sn.pre, ...sn.post].map(x => x.id))] : sn.post.map(x => x.id);
    }
    return [];
}

function speakerOfBlock(block, cmap) {
    const els = block.querySelectorAll('font[color], [style*="color"]');
    for (const el of els) {
        if (el.closest('.npcb-speaker')) continue;
        const col = normColor(el.getAttribute('color') || el.style?.color);
        if (col && cmap.has(col)) return cmap.get(col);
    }
    return null;
}

function decorateMessage(mesid) {
    const s = settings();
    const mesEl = document.querySelector(`#chat .mes[mesid="${mesid}"]`);
    if (!mesEl) return;
    const textEl = mesEl.querySelector('.mes_text');
    if (!textEl) return;
    const msg = (ctx().chat || [])[Number(mesid)];
    const enabled = s.enabled && s.speakerPortraits && msg && !msg.is_user;
    const blocks = Array.from(textEl.children).filter(el => !el.classList.contains('npcb-speaker') && /^(P|DIV|BLOCKQUOTE|LI|UL|OL)$/.test(el.tagName));
    const cmap = enabled ? colorMap(rosterAtMessage(Number(mesid))) : new Map();
    let last = null;
    for (const block of blocks) {
        let want = null;
        if (enabled) {
            const sp = speakerOfBlock(block, cmap);
            if (sp && sp !== last) want = sp;
            if (sp) last = sp;
        }
        const t = want ? lib()[want] : null;
        if (want && !t?.portrait) ensurePortrait(want);
        const url = t?.portrait || '';
        const existing = block.querySelector(':scope > img.npcb-speaker');
        if (!url) {
            if (existing) { existing.remove(); block.classList.remove('npcb-has-speaker'); }
            continue;
        }
        if (existing && existing.dataset.npc === want && existing.getAttribute('src') === url) continue;
        existing?.remove();
        const img = document.createElement('img');
        img.className = 'npcb-speaker';
        img.dataset.npc = want;
        img.src = url;
        img.alt = t.name;
        img.title = t.name;
        img.style.width = img.style.height = `${Number(s.speakerPortraitSize) || 56}px`;
        if (normColor(t.color)) img.style.borderColor = t.color;
        block.insertBefore(img, block.firstChild);
        block.classList.add('npcb-has-speaker');
    }
}

function decorateAll() {
    document.querySelectorAll('#chat .mes[mesid]').forEach(el => decorateMessage(el.getAttribute('mesid')));
}

const pendingDecorate = new Set();
let decorateTimer = null;
function scheduleDecorate(mesid) {
    if (mesid === undefined || mesid === null) return;
    pendingDecorate.add(String(mesid));
    clearTimeout(decorateTimer);
    decorateTimer = setTimeout(() => {
        const ids = [...pendingDecorate];
        pendingDecorate.clear();
        ids.forEach(decorateMessage);
    }, 150);
}

function observeChat() {
    const chatEl = document.getElementById('chat');
    if (!chatEl || chatEl.dataset.npcbObserved) return;
    chatEl.dataset.npcbObserved = '1';
    new MutationObserver((muts) => {
        for (const m of muts) {
            const nodes = [...m.addedNodes];
            if (nodes.length && nodes.every(n => n.nodeType === 1 && n.classList?.contains('npcb-speaker'))) continue;
            const mes = (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.('.mes[mesid]');
            if (mes) scheduleDecorate(mes.getAttribute('mesid'));
            for (const n of nodes) if (n.nodeType === 1 && n.matches?.('.mes[mesid]')) scheduleDecorate(n.getAttribute('mesid'));
        }
    }).observe(chatEl, { childList: true, subtree: true });
}

// ───────────────────────── roster bar ─────────────────────────

function ensureRosterBar() {
    if ($('#npcb_roster').length) return;
    const bar = $(`
        <div id="npcb_roster" class="npcb-roster">
            <div class="npcb-roster-head">
                <span class="npcb-roster-toggle fa-solid fa-chevron-down" title="Collapse / expand"></span>
                <span class="npcb-roster-title">In scene</span>
                <span class="npcb-roster-count"></span>
                <span class="npcb-roster-add fa-solid fa-user-plus" title="Add NPC to scene"></span>
            </div>
            <div class="npcb-roster-body"><div class="npcb-user-slot"></div><div class="npcb-roster-cards"></div></div>
        </div>`);
    $('#send_form').before(bar);
    bar.on('click', '.npcb-roster-toggle', () => { settings().rosterCollapsed = !settings().rosterCollapsed; save(); renderRoster(); });
    bar.on('click', '.npcb-roster-add', (e) => { e.stopPropagation(); openAddPicker(e.currentTarget); });
    bar.on('click', '.npcb-roster-cards .npcb-card', (e) => { e.stopPropagation(); openInstanceEditor($(e.currentTarget).data('id'), e.currentTarget); });
    bar.on('click', '.npcb-user-card', (e) => { e.stopPropagation(); openUserEditor(e.currentTarget); });
}

function renderRoster() {
    ensureRosterBar();
    const s = settings();
    const bar = $('#npcb_roster');
    if (!s.enabled || !hasChat()) { bar.hide(); updateAutoInjection(); return; }
    bar.show().toggleClass('npcb-collapsed', !!s.rosterCollapsed);
    const roster = currentRoster();
    bar.find('.npcb-roster-count').text(roster.length ? `(${roster.length})` : '');
    const cards = roster.map(inst => {
        const t = templateFor(inst);
        if (t && !t.portrait) ensurePortrait(t.id);
        const name = t?.name ?? inst.name ?? inst.id;
        const sub = [inst.posture, inst.state].filter(Boolean).join(' · ');
        return `<div class="npcb-card" data-id="${esc(inst.id)}" title="${esc(name)}${inst.feelings ? `\n💭 ${esc(inst.feelings)}` : ''}">
            ${avatarHtml(t, name)}
            <div class="npcb-card-name" ${HEX_RE.test(t?.color || '') ? `style="color:${t.color}"` : ''}>${esc(name)}</div>
            <div class="npcb-card-sub">${esc(sub)}</div>
        </div>`;
    });
    bar.find('.npcb-roster-cards').html(cards.length ? cards.join('') : '<div class="npcb-empty">Nobody here. Add an NPC, or the LLM will add them as they appear.</div>');
    const us = bar.find('.npcb-user-slot');
    if (s.trackUser) {
        const c = ctx();
        const u = currentUser();
        const ava = personaKey() ? `<img class="npcb-ava" src="${esc(getUserAvatar(personaKey()))}" draggable="false">` : avatarHtml(null, c.name1);
        us.show().html(`<div class="npcb-card npcb-user-card" title="${esc(c.name1)} (you)">${ava}<div class="npcb-card-name">${esc(c.name1)}</div><div class="npcb-card-sub">${esc(u.posture || '')}</div></div>`);
    } else us.hide().empty();
    updateAutoInjection();
}

function closePopovers() { $('.npcb-popover').remove(); }

function placePopover(pop, anchor) {
    $('body').append(pop);
    const r = anchor.getBoundingClientRect();
    const w = pop.outerWidth();
    const h = pop.outerHeight();
    let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    let top = r.top - h - 8;
    if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - h - 8);
    pop.css({ left, top });
}

function openAddPicker(anchor) {
    closePopovers();
    if (!hasChat()) return;
    const present = new Set(currentRoster().map(i => i.id));
    const pop = $(`<div class="npcb-popover npcb-picker">
        <input type="search" class="text_pole npcb-picker-search" placeholder="Search NPCs…">
        <div class="npcb-picker-list"></div>
        <div class="menu_button npcb-picker-new"><i class="fa-solid fa-plus"></i> New NPC…</div>
    </div>`);
    const draw = (q) => {
        const nq = normalize(q);
        const items = Object.values(lib())
            .filter(t => !present.has(t.id))
            .filter(t => !nq || normalize(`${t.name} ${t.id} ${t.description}`).includes(nq))
            .sort((a, b) => a.name.localeCompare(b.name));
        pop.find('.npcb-picker-list').html(items.length ? items.map(t => `
            <div class="npcb-picker-item" data-id="${esc(t.id)}">${avatarHtml(t, t.name, 'npcb-ava-sm')}
                <div><div>${esc(t.name)} <small class="npcb-dim">${esc(t.id)}</small></div><small class="npcb-dim">${esc(traitSummary(t) || t.description || '')}</small></div>
            </div>`).join('') : '<div class="npcb-empty">No matching NPCs.</div>');
    };
    draw('');
    pop.on('input', '.npcb-picker-search', (e) => draw(e.target.value));
    pop.on('click', '.npcb-picker-item', (e) => { addToScene($(e.currentTarget).data('id')); closePopovers(); });
    pop.on('click', '.npcb-picker-new', () => { closePopovers(); openLibrary(null, true); });
    pop.on('click', e => e.stopPropagation());
    placePopover(pop, anchor);
    pop.find('input').trigger('focus');
}

function addToScene(id) {
    const t = lib()[id];
    if (!t || !hasChat()) return;
    const roster = clone(currentRoster());
    if (roster.some(i => i.id === id)) return;
    const s = settings();
    roster.push({ id, name: t.name, posture: s.postures[0] ?? '', state: s.states[0] ?? '', feelings: '', outfit: outfitFromDefault(t.defaultWorn, t.wardrobe || [], s.conditions) });
    writeCurrentRoster(roster);
}

function removeFromScene(id) {
    writeCurrentRoster(currentRoster().filter(i => i.id !== id));
}

function openInstanceEditor(id, anchor) {
    closePopovers();
    const inst = currentRoster().find(i => i.id === id);
    if (!inst) return;
    const t = templateFor(inst);
    const s = settings();
    const name = t?.name ?? inst.name ?? id;
    const opts = (list, cur) => {
        const all = [...list];
        if (cur && !all.includes(cur)) all.unshift(cur);
        return all.map(x => `<option value="${esc(x)}" ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
    };
    const pop = $(`<div class="npcb-popover npcb-inst">
        <div class="npcb-inst-head">${avatarHtml(t, name, 'npcb-ava-md')}
            <div><b>${esc(name)}</b><br><small class="npcb-dim">${esc(id)}${t ? '' : ' · card deleted'}</small></div>
        </div>
        <div class="npcb-tabs"><div class="npcb-tab active" data-tab="state">State</div><div class="npcb-tab" data-tab="outfit">Outfit</div></div>
        <div class="npcb-tabpane" data-pane="state">
        <label>Current posture<select class="text_pole npcb-i-posture">${opts(s.postures, inst.posture)}</select></label>
        <label>Current state<select class="text_pole npcb-i-state">${opts(s.states, inst.state)}</select></label>
        <label>Current feelings (inner thoughts)<textarea class="text_pole npcb-i-feelings" rows="3">${esc(inst.feelings)}</textarea></label>
        </div>
        <div class="npcb-tabpane" data-pane="outfit" style="display:none"><div class="npcb-doll-host"></div></div>
        <div class="npcb-row">
            <div class="menu_button npcb-i-save"><i class="fa-solid fa-check"></i> Save</div>
            <div class="menu_button npcb-i-card" ${t ? '' : 'style="display:none"'}><i class="fa-solid fa-id-card"></i> Card</div>
            <div class="menu_button npcb-i-remove redWarningBG"><i class="fa-solid fa-user-minus"></i> Remove</div>
        </div>
    </div>`);
    pop.on('click', e => e.stopPropagation());
    let draftOutfit = clone(inst.outfit ?? outfitFromDefault(t?.defaultWorn, t?.wardrobe || [], s.conditions));
    bindTabs(pop);
    mountPaperdoll(pop.find('.npcb-doll-host'), () => draftOutfit, (o) => { draftOutfit = o; }, () => t?.wardrobe || [], t ? () => { closePopovers(); openLibrary(id, false, 'wardrobe'); } : null);
    pop.on('click', '.npcb-i-save', () => {
        const roster = clone(currentRoster());
        const target = roster.find(i => i.id === id);
        if (target) {
            target.outfit = draftOutfit;
            target.posture = String(pop.find('.npcb-i-posture').val() ?? '');
            target.state = String(pop.find('.npcb-i-state').val() ?? '');
            target.feelings = String(pop.find('.npcb-i-feelings').val() ?? '').trim();
            writeCurrentRoster(roster);
        }
        closePopovers();
    });
    pop.on('click', '.npcb-i-remove', () => { removeFromScene(id); closePopovers(); });
    pop.on('click', '.npcb-i-card', () => { closePopovers(); openLibrary(id); });
    placePopover(pop, anchor);
}

// ───────────────────────── paperdoll / wardrobe UI ─────────────────────────

function bindTabs(root) {
    root.off('click.tabs').on('click.tabs', '.npcb-tab', (e) => {
        const tab = $(e.currentTarget);
        const bar = tab.closest('.npcb-tabs');
        bar.find('.npcb-tab').removeClass('active');
        tab.addClass('active');
        const scope = bar.parent();
        scope.children('.npcb-tabpane').hide();
        scope.children(`.npcb-tabpane[data-pane="${tab.data('tab')}"]`).show();
    });
}

function condOptions(cur) {
    const list = [...settings().conditions];
    if (cur && !list.includes(cur)) list.unshift(cur);
    return list.map(x => `<option value="${esc(x)}" ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
}

/** Paperdoll: shows what is worn per slot; click a slot to change it. */
function mountPaperdoll(host, getOutfit, setOutfit, getWardrobe, onEditWardrobe) {
    const s = settings();
    const draw = (openSlot = null) => {
        const wardrobe = getWardrobe();
        const outfit = getOutfit();
        const bySlot = outfitBySlot(outfit, wardrobe);
        const cell = (key) => {
            const label = SLOT_LABEL[key];
            const worn = bySlot[key];
            const txt = worn.length ? worn.map(w => `${esc(w.item.name)}${w.condition && w.condition !== s.conditions[0] ? ` <i class="npcb-cond">${esc(w.condition)}</i>` : ''}`).join(', ') : '<span class="npcb-dim">—</span>';
            return `<div class="npcb-slot ${openSlot === key ? 'open' : ''} ${worn.length ? 'filled' : ''}" data-slot="${key}" style="grid-area:${key}"><div class="npcb-slot-label">${esc(label)}</div><div class="npcb-slot-items">${txt}</div></div>`;
        };
        let editor = '';
        if (openSlot) {
            const fits = wardrobe.filter(i => i.slots.includes(openSlot));
            const wornHere = bySlot[openSlot].map(w => w.item.id);
            editor = `<div class="npcb-slot-editor">
                <b>${esc(SLOT_LABEL[openSlot])}</b>
                ${fits.length ? fits.map(i => {
                    const w = outfit.find(x => x.id === i.id);
                    return `<div class="npcb-row npcb-slot-opt" data-item="${esc(i.id)}">
                        <label class="checkbox_label"><input type="checkbox" class="npcb-wear" ${wornHere.includes(i.id) ? 'checked' : ''}> ${esc(i.name)}${i.slots.length > 1 ? ` <small class="npcb-dim">(${i.slots.map(k => SLOT_LABEL[k]).join(' + ')})</small>` : ''}</label>
                        <select class="text_pole npcb-cond-sel" ${w ? '' : 'disabled'}>${condOptions(w?.condition)}</select>
                    </div>`;
                }).join('') : '<div class="npcb-empty">No wardrobe items for this slot.</div>'}
            </div>`;
        }
        host.html(`<div class="npcb-doll">${SLOTS.map(x => cell(x.key)).join('')}</div>${editor}
            ${onEditWardrobe ? '<div class="menu_button npcb-edit-wardrobe"><i class="fa-solid fa-shirt"></i> Edit wardrobe</div>' : ''}`);
        host.data('openSlot', openSlot);
        const pop = host.closest('.npcb-popover');
        if (pop.length) {
            const r = pop[0].getBoundingClientRect();
            if (r.bottom > window.innerHeight - 8) pop.css('top', Math.max(8, window.innerHeight - 8 - r.height));
        }
    };
    host.off('.doll');
    host.on('click.doll', '.npcb-slot', (e) => { const k = $(e.currentTarget).data('slot'); draw(host.data('openSlot') === k ? null : k); });
    host.on('change.doll', '.npcb-wear', (e) => {
        const id = $(e.target).closest('.npcb-slot-opt').data('item');
        const wardrobe = getWardrobe();
        if (e.target.checked) setOutfit(wearItem(getOutfit(), wardrobe, id, s.conditions[0]).outfit);
        else setOutfit(getOutfit().filter(w => w.id !== id));
        draw(host.data('openSlot'));
    });
    host.on('change.doll', '.npcb-cond-sel', (e) => {
        const id = $(e.target).closest('.npcb-slot-opt').data('item');
        setOutfit(getOutfit().map(w => w.id === id ? { ...w, condition: String($(e.target).val()) } : w));
        draw(host.data('openSlot'));
    });
    host.on('click.doll', '.npcb-edit-wardrobe', () => onEditWardrobe?.());
    draw();
}

/** Wardrobe editor: mutates data = { wardrobe: [], defaultWorn: [] } in place. */
function mountWardrobeEditor(host, data) {
    const draw = () => {
        const rows = data.wardrobe.map(i => `
            <div class="npcb-wd-item" data-item="${esc(i.id)}">
                <div class="npcb-row">
                    <input class="text_pole npcb-wd-name" value="${esc(i.name)}" placeholder="Item name">
                    <label class="checkbox_label" title="Worn when this character enters a scene"><input type="checkbox" class="npcb-wd-default" ${data.defaultWorn.includes(i.id) ? 'checked' : ''}> Default</label>
                    <div class="menu_button npcb-wd-del" title="Delete item"><i class="fa-solid fa-trash-can"></i></div>
                </div>
                <div class="npcb-wd-slots">${SLOTS.map(x => `<span class="npcb-chip ${i.slots.includes(x.key) ? 'on' : ''}" data-slot="${x.key}">${esc(x.label)}</span>`).join('')}</div>
                <small class="npcb-dim">id: ${esc(i.id)}</small>
            </div>`).join('');
        host.html(`<div class="npcb-wd-list">${rows || '<div class="npcb-empty">No clothing yet.</div>'}</div>
            <div class="npcb-row"><input class="text_pole npcb-wd-newname" placeholder="New item, e.g. Blue dress"><div class="menu_button npcb-wd-add"><i class="fa-solid fa-plus"></i> Add</div></div>
            <small class="npcb-dim">Click slot chips to choose which body slots an item covers (a dress = Upper (outer) + Lower (outer)). "Default" items are worn when the character enters a scene.</small>`);
    };
    const itemOf = (el) => data.wardrobe.find(i => i.id === $(el).closest('.npcb-wd-item').data('item'));
    host.off('.wd');
    host.on('input.wd', '.npcb-wd-name', (e) => { const it = itemOf(e.target); if (it) it.name = String($(e.target).val()); });
    host.on('change.wd', '.npcb-wd-default', (e) => {
        const it = itemOf(e.target);
        if (!it) return;
        data.defaultWorn = data.defaultWorn.filter(x => x !== it.id);
        if (e.target.checked) {
            // keep defaults consistent: a new default replaces conflicting defaults
            const s = settings();
            data.defaultWorn = wearItem(data.defaultWorn.map(id => ({ id })), data.wardrobe, it.id, s.conditions[0]).outfit.map(w => w.id);
            draw();
        }
    });
    host.on('click.wd', '.npcb-chip', (e) => {
        const it = itemOf(e.target);
        if (!it) return;
        const k = $(e.target).data('slot');
        it.slots = it.slots.includes(k) ? it.slots.filter(x => x !== k) : [...it.slots, k];
        if (!it.slots.length) it.slots = [k];
        $(e.target).closest('.npcb-wd-slots').find('.npcb-chip').each((_, c) => $(c).toggleClass('on', it.slots.includes($(c).data('slot'))));
    });
    host.on('click.wd', '.npcb-wd-del', (e) => {
        const it = itemOf(e.target);
        if (!it) return;
        data.wardrobe = data.wardrobe.filter(x => x !== it);
        data.defaultWorn = data.defaultWorn.filter(x => x !== it.id);
        draw();
    });
    const add = () => {
        const name = String(host.find('.npcb-wd-newname').val() ?? '').trim();
        if (!name) return;
        const id = uniqueId(name, x => data.wardrobe.some(i => i.id === x));
        data.wardrobe.push({ id, name, slots: inferSlots(name), note: '' });
        draw();
        host.find('.npcb-wd-newname').trigger('focus');
    };
    host.on('click.wd', '.npcb-wd-add', add);
    host.on('keydown.wd', '.npcb-wd-newname', (e) => { if (e.key === 'Enter') add(); });
    draw();
}

function openUserEditor(anchor) {
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
    const pop = $(`<div class="npcb-popover npcb-inst">
        <div class="npcb-inst-head">${ava}<div><b>${esc(c.name1)}</b><br><small class="npcb-dim">you · persona</small></div></div>
        <label>Current posture<select class="text_pole npcb-u-posture">${opts(s.postures, u.posture)}</select></label>
        <div class="npcb-doll-host"></div>
        <div class="npcb-row"><div class="menu_button npcb-u-save"><i class="fa-solid fa-check"></i> Save</div></div>
    </div>`);
    pop.on('click', e => e.stopPropagation());
    let draft = u.outfit;
    mountPaperdoll(pop.find('.npcb-doll-host'), () => draft, (o) => { draft = o; }, () => personaData().wardrobe, () => { closePopovers(); openPersonaWardrobe(); });
    pop.on('click', '.npcb-u-save', () => {
        writeCurrentRoster(null, { ...u, posture: String(pop.find('.npcb-u-posture').val() ?? ''), outfit: draft });
        closePopovers();
    });
    placePopover(pop, anchor);
}

async function openPersonaWardrobe() {
    const c = ctx();
    const p = personaData();
    const data = clone({ wardrobe: p.wardrobe, defaultWorn: p.defaultWorn });
    const box = $(`<div class="npcb-wd-popup"><h3>${esc(c.name1)}'s wardrobe</h3><div class="npcb-wd-host"></div></div>`);
    mountWardrobeEditor(box.find('.npcb-wd-host'), data);
    const ok = await c.callGenericPopup(box, c.POPUP_TYPE.CONFIRM, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: 'Save', cancelButton: 'Cancel' });
    if (!ok) return;
    p.wardrobe = data.wardrobe.filter(i => i.name.trim());
    p.defaultWorn = data.defaultWorn.filter(id => p.wardrobe.some(i => i.id === id));
    save();
    // drop worn items that no longer exist
    const u = currentUser();
    let outfit = (u.outfit || []).filter(w => p.wardrobe.some(i => i.id === w.id));
    if (!outfit.length) outfit = outfitFromDefault(p.defaultWorn, p.wardrobe, settings().conditions);
    writeCurrentRoster(null, { ...u, outfit });
}

// ───────────────────────── NPC Library (top bar) ─────────────────────────

let libSelected = null;
let libIsNew = false;
let libDraftPortrait = null;
let libDraftWardrobe = null;

function ensureTopButton() {
    if ($('#npcb_topbar').length) return;
    const btn = $(`<div id="npcb_topbar" class="drawer"><div class="drawer-toggle drawer-header">
        <div class="drawer-icon fa-solid fa-users-viewfinder fa-fw closedIcon" title="NPC Book"></div></div></div>`);
    const anchor = $('#rightNavHolder');
    if (anchor.length) anchor.before(btn); else $('#top-settings-holder').append(btn);
    btn.on('click', (e) => { e.stopPropagation(); openLibrary(); });
}

function ensureLibraryModal() {
    if ($('#npcb_library').length) return;
    const modal = $(`
    <div id="npcb_library" class="npcb-modal" style="display:none">
      <div class="npcb-modal-panel">
        <div class="npcb-modal-head">
          <b><i class="fa-solid fa-users-viewfinder"></i> NPC Book</b>
          <span class="npcb-spacer"></span>
          <div class="menu_button npcb-lib-import" title="Import JSON"><i class="fa-solid fa-file-import"></i></div>
          <div class="menu_button npcb-lib-export" title="Export all NPCs as JSON"><i class="fa-solid fa-file-export"></i></div>
          <div class="menu_button npcb-lib-close" title="Close"><i class="fa-solid fa-xmark"></i></div>
          <input type="file" class="npcb-lib-import-file" accept=".json,application/json" hidden>
        </div>
        <div class="npcb-modal-body">
          <div class="npcb-lib-side">
            <div class="npcb-row">
              <input type="search" class="text_pole npcb-lib-search" placeholder="Search…">
              <div class="menu_button npcb-lib-new" title="New NPC"><i class="fa-solid fa-plus"></i></div>
            </div>
            <div class="npcb-lib-list"></div>
          </div>
          <div class="npcb-lib-editor"></div>
        </div>
      </div>
    </div>`);
    $('body').append(modal);
    modal.on('click', (e) => { if (e.target === modal[0]) closeLibrary(); });
    modal.on('click', '.npcb-lib-close', closeLibrary);
    modal.on('click', '.npcb-lib-new', () => selectTemplate(null, true));
    modal.on('input', '.npcb-lib-search', renderLibraryList);
    modal.on('click', '.npcb-lib-item', (e) => selectTemplate($(e.currentTarget).data('id')));
    modal.on('click', '.npcb-lib-export', exportLibrary);
    modal.on('click', '.npcb-lib-import', () => modal.find('.npcb-lib-import-file').trigger('click'));
    modal.on('change', '.npcb-lib-import-file', importLibrary);
}

function openLibrary(id = null, isNew = false, tab = 'card') {
    ensureLibraryModal();
    $('#npcb_library').css('display', 'flex');
    renderLibraryList();
    const first = id ?? libSelected ?? Object.keys(lib()).sort()[0] ?? null;
    selectTemplate(isNew ? null : first, isNew || !first, tab);
}

function closeLibrary() { $('#npcb_library').hide(); }

function renderLibraryList() {
    const modal = $('#npcb_library');
    if (!modal.length) return;
    const q = normalize(modal.find('.npcb-lib-search').val());
    const present = new Set(hasChat() ? currentRoster().map(i => i.id) : []);
    const items = Object.values(lib())
        .filter(t => !q || normalize(`${t.name} ${t.id} ${t.description}`).includes(q))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    modal.find('.npcb-lib-list').html(items.length ? items.map(t => `
        <div class="npcb-lib-item ${t.id === libSelected && !libIsNew ? 'active' : ''}" data-id="${esc(t.id)}">
          ${avatarHtml(t, t.name, 'npcb-ava-sm')}
          <div class="npcb-lib-item-text"><div>${esc(t.name)} ${present.has(t.id) ? '<i class="fa-solid fa-circle npcb-present-dot" title="In this scene"></i>' : ''}${t.auto ? ' <small class="npcb-badge">auto</small>' : ''}</div>
          <small class="npcb-dim">${esc(t.id)}</small></div>
        </div>`).join('') : '<div class="npcb-empty">No NPCs yet.</div>');
}

function selectTemplate(id, isNew = false, tab = 'card') {
    libIsNew = isNew;
    libSelected = isNew ? null : id;
    libDraftPortrait = null;
    libDraftWardrobe = null;
    renderLibraryList();
    const ed = $('#npcb_library .npcb-lib-editor');
    const t = isNew ? { id: '', name: '', portrait: '', description: '', details: '', traits: {}, color: pickColor() } : lib()[id];
    if (!t) { ed.html('<div class="npcb-empty">Select or create an NPC.</div>'); return; }
    const s = settings();
    const traitKeys = [...new Set([...s.traitKeys, ...Object.keys(t.traits || {})])];
    const present = hasChat() && !isNew && currentRoster().some(i => i.id === t.id);
    libDraftWardrobe = clone({ wardrobe: t.wardrobe || [], defaultWorn: t.defaultWorn || [] });
    ed.html(`
      <div class="npcb-tabs"><div class="npcb-tab ${tab === 'card' ? 'active' : ''}" data-tab="card">Card</div><div class="npcb-tab ${tab === 'wardrobe' ? 'active' : ''}" data-tab="wardrobe">Wardrobe (${(t.wardrobe || []).length})</div></div>
      <div class="npcb-tabpane" data-pane="card" ${tab === 'card' ? '' : 'style="display:none"'}>
      <div class="npcb-ed-top">
        <div class="npcb-ed-portrait" title="Click to set portrait">${avatarHtml(t, t.name || '?', 'npcb-ava-lg')}</div>
        <input type="file" class="npcb-ed-file" accept="image/*" hidden>
        <div class="npcb-ed-ident">
          <label>ID ${isNew ? '<small class="npcb-dim">(unique, cannot be changed later)</small>' : '<small class="npcb-dim">(locked)</small>'}
            <input class="text_pole npcb-ed-id" value="${esc(t.id)}" ${isNew ? '' : 'disabled'} placeholder="auto from name"></label>
          <label>Name<input class="text_pole npcb-ed-name" value="${esc(t.name)}" placeholder="Display name"></label>
          <label>Dialogue color <small class="npcb-dim">(the LLM wraps this character's dialogue in &lt;font color&gt;)</small>
            <div class="npcb-row npcb-color-row">
              <input type="color" class="npcb-ed-color" value="${HEX_RE.test(t.color || '') ? t.color : '#ffffff'}">
              <input class="text_pole npcb-ed-colorhex" value="${esc(t.color || '')}" placeholder="#RRGGBB (empty = none)">
              <span class="npcb-color-preview" style="color:${HEX_RE.test(t.color || '') ? t.color : 'inherit'}">"Sample line."</span>
            </div></label>
          <div class="npcb-row npcb-ed-portrait-btns">
            <div class="menu_button npcb-ed-setimg"><i class="fa-solid fa-image"></i> Portrait</div>
            <div class="menu_button npcb-ed-clrimg"><i class="fa-solid fa-trash-can"></i></div>
            ${isNew ? '' : '<div class="menu_button npcb-ed-genimg" title="Generate with the Image Generation extension"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</div>'}
          </div>
        </div>
      </div>
      <label>Description <small class="npcb-dim">(only you see this — never sent to the LLM)</small>
        <textarea class="text_pole npcb-ed-desc" rows="3">${esc(t.description)}</textarea></label>
      <label>Details <small class="npcb-dim">(sent to the LLM while this NPC is in the scene)</small>
        <textarea class="text_pole npcb-ed-details" rows="10">${esc(t.details)}</textarea></label>
      <div class="npcb-ed-traits">
        <div><b>Identity</b> <small class="npcb-dim">(used to tell same-name characters apart; empty fields fall back to searching the Details text)</small></div>
        ${traitKeys.map(k => `<label>${esc(k)}<input class="text_pole npcb-ed-trait" data-key="${esc(k)}" value="${esc(t.traits?.[k] ?? '')}"></label>`).join('')}
      </div>
      </div>
      <div class="npcb-tabpane" data-pane="wardrobe" ${tab === 'wardrobe' ? '' : 'style="display:none"'}>
        <div class="npcb-wd-host"></div>
      </div>
      <div class="npcb-row npcb-ed-actions">
        <div class="menu_button npcb-ed-save"><i class="fa-solid fa-floppy-disk"></i> Save</div>
        ${isNew ? '' : `<div class="menu_button npcb-ed-scene">${present ? '<i class="fa-solid fa-user-minus"></i> Remove from scene' : '<i class="fa-solid fa-user-plus"></i> Add to scene'}</div>`}
        ${isNew ? '' : '<div class="menu_button npcb-ed-dup"><i class="fa-solid fa-clone"></i> Duplicate</div>'}
        <span class="npcb-spacer"></span>
        ${isNew ? '' : '<div class="menu_button redWarningBG npcb-ed-del"><i class="fa-solid fa-trash"></i> Delete</div>'}
      </div>`);

    ed.off('.npcb');
    bindTabs(ed);
    mountWardrobeEditor(ed.find('.npcb-wd-host'), libDraftWardrobe);
    ed.on('click.npcb', '.npcb-ed-portrait, .npcb-ed-setimg', () => ed.find('.npcb-ed-file').trigger('click'));
    ed.on('change.npcb', '.npcb-ed-file', async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            libDraftPortrait = await resizeImage(file, 512);
            ed.find('.npcb-ed-portrait').html(`<img class="npcb-ava npcb-ava-lg" src="${libDraftPortrait}">`);
        } catch (err) { toastr.error('Could not read image.', 'NPC Book'); }
    });
    ed.on('click.npcb', '.npcb-ed-genimg', () => {
        toastr.info(`Generating a portrait for ${t.name}…`, 'NPC Book');
        ensurePortrait(t.id, { force: true });
    });
    ed.on('click.npcb', '.npcb-ed-clrimg', () => {
        libDraftPortrait = '';
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
        const ok = await c.callGenericPopup(`Delete NPC <b>${esc(t.name)}</b> (${esc(t.id)})? Scenes that contain it keep their entry but lose its details.`, c.POPUP_TYPE.CONFIRM);
        if (!ok) return;
        delete lib()[t.id];
        save();
        libSelected = null;
        openLibrary();
        renderRoster();
    });
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
    if (libDraftPortrait === '') portrait = '';
    else if (libDraftPortrait) {
        try { portrait = await uploadPortrait(libDraftPortrait, id); } catch (e) { console.warn('[NPC Book] upload failed, storing inline', e); portrait = libDraftPortrait; }
    }
    lib()[id] = {
        ...(isNew ? {} : t),
        id, name, portrait,
        description: String(ed.find('.npcb-ed-desc').val() ?? ''),
        details: String(ed.find('.npcb-ed-details').val() ?? ''),
        traits,
        color: color.toLowerCase(),
        wardrobe: (libDraftWardrobe?.wardrobe ?? t.wardrobe ?? []).filter(i => i.name.trim()),
        defaultWorn: (libDraftWardrobe?.defaultWorn ?? t.defaultWorn ?? []),
        auto: isNew ? false : !!t.auto,
        created: t.created || Date.now(),
        updated: Date.now(),
    };
    save();
    toastr.success(`Saved ${name}.`, 'NPC Book');
    // Keep the live scene in sync with the card's wardrobe.
    if (hasChat()) {
        const t2 = lib()[id];
        const roster = clone(currentRoster());
        const inst = roster.find(i => i.id === id);
        if (inst) {
            let outfit = (inst.outfit || []).filter(w => t2.wardrobe.some(i => i.id === w.id));
            if (!outfit.length) outfit = outfitFromDefault(t2.defaultWorn, t2.wardrobe, settings().conditions);
            if (JSON.stringify(outfit) !== JSON.stringify(inst.outfit || [])) { inst.outfit = outfit; writeCurrentRoster(roster); }
        }
    }
    selectTemplate(id, false, String(ed.find('.npcb-tab.active').data('tab') || 'card'));
    renderRoster();
}

function resizeImage(file, max) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => {
            const img = new Image();
            img.onerror = reject;
            img.onload = () => {
                const scale = Math.min(1, max / Math.max(img.width, img.height));
                const cv = document.createElement('canvas');
                cv.width = Math.round(img.width * scale);
                cv.height = Math.round(img.height * scale);
                cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                resolve(cv.toDataURL('image/webp', 0.9));
            };
            img.src = String(reader.result);
        };
        reader.readAsDataURL(file);
    });
}

async function uploadPortrait(dataUrl, id) {
    const m = String(dataUrl).match(/^data:image\/(\w+);base64,(.+)$/);
    if (!m) throw new Error('bad data url');
    const format = m[1] === 'jpeg' ? 'jpg' : m[1];
    const res = await fetch('/api/images/upload', {
        method: 'POST',
        headers: ctx().getRequestHeaders(),
        body: JSON.stringify({ image: m[2], format, ch_name: 'npc-book', filename: `${slugify(id)}_${Date.now()}` }),
    });
    if (!res.ok) throw new Error(`upload ${res.status}`);
    const data = await res.json();
    const p = String(data.path || '').replace(/\\/g, '/');
    return p.startsWith('/') ? p : `/${p}`;
}

function exportLibrary() {
    const blob = new Blob([JSON.stringify({ npcbook: 1, npcs: Object.values(lib()) }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `npc-book-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importLibrary(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
        const data = JSON.parse(await file.text());
        const list = Array.isArray(data) ? data : (data.npcs || []);
        let added = 0, renamed = 0;
        for (const raw of list) {
            if (!raw?.name) continue;
            let id = String(raw.id || '').toLowerCase();
            if (!ID_PATTERN.test(id)) id = slugify(raw.name);
            if (lib()[id]) { id = uniqueId(id, x => !!lib()[x]); renamed++; }
            lib()[id] = { portrait: '', description: '', details: '', traits: {}, ...raw, id, created: raw.created || Date.now() };
            added++;
        }
        save();
        renderLibraryList();
        toastr.success(`Imported ${added} NPC(s)${renamed ? `, ${renamed} got a new ID because theirs was taken` : ''}.`, 'NPC Book');
    } catch (err) {
        toastr.error('Invalid JSON file.', 'NPC Book');
    }
}

// ───────────────────────── settings panel ─────────────────────────

async function mountSettings() {
    const html = await $.get(`${EXT_FOLDER}settings.html`);
    $('#extensions_settings2').append(html);
    const s = settings();
    const root = $('#npcb_settings');
    const bind = (sel, key, type = 'text') => {
        const el = root.find(sel);
        if (type === 'checkbox') el.prop('checked', !!s[key]);
        else if (type === 'list') el.val(s[key].join('\n'));
        else el.val(s[key]);
        el.on(type === 'checkbox' ? 'change' : 'input', () => {
            if (type === 'checkbox') s[key] = el.prop('checked');
            else if (type === 'number') s[key] = Number(el.val());
            else if (type === 'list') s[key] = String(el.val()).split(/\n|,/).map(x => x.trim()).filter(Boolean);
            else s[key] = String(el.val());
            save();
            syncModeUi();
            updateAutoInjection();
            renderRoster();
        });
    };
    bind('#npcb_enabled', 'enabled', 'checkbox');
    bind('#npcb_mode', 'injectMode');
    bind('#npcb_scene_pos', 'scenePosition', 'number');
    bind('#npcb_scene_depth', 'sceneDepth', 'number');
    bind('#npcb_scene_role', 'sceneRole', 'number');
    bind('#npcb_instr_pos', 'instrPosition', 'number');
    bind('#npcb_instr_depth', 'instrDepth', 'number');
    bind('#npcb_instr_role', 'instrRole', 'number');
    bind('#npcb_instructions', 'instructions');
    bind('#npcb_header', 'sceneHeader');
    bind('#npcb_include_lib', 'includeLibrary', 'checkbox');
    bind('#npcb_autocreate', 'autoCreate', 'checkbox');
    bind('#npcb_trackchar', 'trackChar', 'checkbox');
    bind('#npcb_trackuser', 'trackUser', 'checkbox');
    bind('#npcb_dialoguecolors', 'dialogueColors', 'checkbox');
    bind('#npcb_speakerportraits', 'speakerPortraits', 'checkbox');
    bind('#npcb_speakersize', 'speakerPortraitSize', 'number');
    bind('#npcb_autoportraits', 'autoPortraits', 'checkbox');
    bind('#npcb_portraitprompt', 'portraitPrompt');
    bind('#npcb_portraitmode', 'portraitMode');
    bind('#npcb_portraitllm', 'portraitLlmPrompt');
    root.find('#npcb_reset_portraitllm').on('click', () => { s.portraitLlmPrompt = DEFAULT_PORTRAIT_LLM_PROMPT; root.find('#npcb_portraitllm').val(s.portraitLlmPrompt); save(); });
    root.find('#npcb_speakerportraits, #npcb_speakersize').on('input change', () => decorateAll());
    bind('#npcb_colorrule', 'colorRule');
    root.find('#npcb_reset_color').on('click', () => { s.colorRule = DEFAULT_COLOR_RULE; root.find('#npcb_colorrule').val(s.colorRule); save(); });
    bind('#npcb_trackoutfits', 'trackOutfits', 'checkbox');
    bind('#npcb_incwardrobe', 'includeWardrobe', 'checkbox');
    bind('#npcb_wdgrowth', 'allowWardrobeGrowth', 'checkbox');
    bind('#npcb_outfitrules', 'outfitRules');
    bind('#npcb_conditions', 'conditions', 'list');
    root.find('#npcb_reset_outfit').on('click', () => { s.outfitRules = DEFAULT_OUTFIT_RULES; root.find('#npcb_outfitrules').val(s.outfitRules); save(); });
    bind('#npcb_threshold', 'threshold', 'number');
    bind('#npcb_tolerance', 'numericTolerance', 'number');
    bind('#npcb_traitkeys', 'traitKeys', 'list');
    bind('#npcb_postures', 'postures', 'list');
    bind('#npcb_states', 'states', 'list');
    root.find('#npcb_threshold').on('input', () => root.find('#npcb_threshold_val').text(`${s.threshold}%`));
    root.find('#npcb_threshold_val').text(`${s.threshold}%`);
    root.find('#npcb_install_pm').on('click', installPmEntries);
    root.find('#npcb_reset_instr').on('click', () => { s.instructions = DEFAULT_INSTRUCTIONS; root.find('#npcb_instructions').val(s.instructions); save(); });
    root.find('#npcb_open_lib').on('click', () => openLibrary());
    root.find('#npcb_preview').on('click', async () => {
        const c = ctx();
        const text = `<h4>{{npcInstructions}}</h4><pre class="npcb-pre">${esc(buildInstructionText() || '(empty)')}</pre><h4>{{npcScene}}</h4><pre class="npcb-pre">${esc(buildSceneText() || '(empty — nobody in scene)')}</pre>`;
        await c.callGenericPopup(text, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });
    });
    syncModeUi();
    renderPmStatus();
}

function syncModeUi() {
    const s = settings();
    $('#npcb_auto_opts').toggle(s.injectMode === 'auto');
    $('#npcb_pm_opts').toggle(s.injectMode === 'pm');
    renderPmStatus();
}

// ───────────────────────── init ─────────────────────────

jQuery(async () => {
    settings();
    registerMacros();
    ensureTopButton();
    ensureLibraryModal();
    ensureRosterBar();
    await mountSettings();

    const { eventSource, eventTypes } = ctx();
    eventSource.on(eventTypes.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(eventTypes.MESSAGE_RECEIVED, (id, type) => { if (type === 'first_message') processGreetings(); else processLastMessage(); });
    const finish = () => setTimeout(() => processLastMessage(), 0);
    eventSource.on(eventTypes.GENERATION_ENDED, finish);
    eventSource.on(eventTypes.GENERATION_STOPPED, finish);
    eventSource.on(eventTypes.CHAT_CHANGED, () => { genCtx = null; closePopovers(); renderRoster(); renderLibraryList(); updateAutoInjection(); processGreetings(); setTimeout(decorateAll, 300); });
    eventSource.on(eventTypes.MESSAGE_EDITED, (id) => { const m = ctx().chat?.[id]; if (m && !m.is_user && (ctx().chat.slice(0, id).every(x => !x.is_user))) processGreetings(); });
    eventSource.on(eventTypes.MORE_MESSAGES_LOADED, () => setTimeout(decorateAll, 100));
    for (const ev of [eventTypes.MESSAGE_SWIPED, eventTypes.MESSAGE_DELETED, eventTypes.MESSAGE_EDITED]) {
        eventSource.on(ev, () => { renderRoster(); updateAutoInjection(); });
    }
    eventSource.on(eventTypes.SETTINGS_UPDATED, renderPmStatus);
    eventSource.on(eventTypes.PERSONA_CHANGED, () => { closePopovers(); renderRoster(); });
    $(document).on('click', (e) => { if (!$(e.target).closest('.npcb-popover').length) closePopovers(); });
    $(document).on('keydown', (e) => { if (e.key === 'Escape') { closePopovers(); closeLibrary(); } });

    renderRoster();
    updateAutoInjection();
    observeChat();
    decorateAll();
    console.log('[NPC Book] loaded');
});
