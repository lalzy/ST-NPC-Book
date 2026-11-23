// NPC Book — character-scoped NPC cards for SillyTavern.
// NPC details are injected ONLY while the NPC is present in the current chat's scene roster.

import {
    extractTracker, applyTracker, uniqueId, slugify, ID_PATTERN, normalize, pickEnum, parseLenientJson, normalizeSlots,
    extractCharacterList, resolveRef, normColor, exposureSummary, applyCastOverrides,
    defaultPronouns, PROFILE_FIELDS,
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
const INJECT_REMIND_KEY = 'npcbook_speaker_reminder';

const DEFAULT_INSTRUCTIONS = `[Scene tracking]
Write your reply as usual. Then, at the very end, add one <npcs> block that records what CHANGED in the scene during your reply. Do not explain or plan the block; just write it.

Put in the block:
- A character already in the scene whose posture, state, feelings or clothing changed in your reply: their "id" and only the fields that changed. Compare with the scene: if a character's mood in your reply no longer matches their listed state (listed Calm, but your reply shows cold anger), that is a change, so give the new state.
- A character who arrived: their "id" from Known NPCs, plus "posture" and "state". Someone not in Known NPCs (or a different person who shares a name) gets "name" and "new": true, plus "traits" with [[TRAIT_KEYS]] and the profile fields shown in the example.
- A character who left: {"id": "...", "left": true}.
- Report only what your reply actually shows. Leave out everyone and everything that did not change. If nothing changed, write <npcs>[]</npcs>.
- Never list [[EXCLUDE]].

Values:
- "posture" is one of: [[POSTURES]]
- "state" is one of: [[STATES]]
- "feelings" is the character's private thoughts right now, 1-2 sentences.
[[SPEAKER_RULE]]
[[OUTFIT_RULES]]

Example:
<npcs>
[
  {"id": "existing_id", "posture": "Sitting"},
  {"id": "other_id", "left": true},
  {"name": "Mara", "new": true, "traits": {[[TRAIT_EXAMPLE]]}, "posture": "Standing", "state": "Curious", "feelings": "Who are these people?", "description": "Traveling herbalist.", "details": "Lean, sun-browned, grey-streaked braid. Blunt and practical, distrusts nobles. Grew up in the hill villages; speaks in short sentences.", "height": "168 cm", "pronouns": "she/her", "sexuality": "heterosexual", "sexual_experience": "experienced"}[[USER_EXAMPLE]]
]
</npcs>

Known NPCs (id: name — identity):
[[LIBRARY]]`;

const DEFAULT_OUTFIT_RULES = `Clothing:
- Characters only wear items from their own wardrobe (listed in the scene). Never invent clothing for someone who has a wardrobe.
- When someone's clothing changes, add "outfit": {"wear": ["item_id"], "remove": ["item_id"], "condition": {"item_id": "<condition>"}} to their entry. Putting an item on replaces whatever is in the same slots.
- Choose clothing that fits the situation, e.g. sleepwear in bed.
- <wearing> is what each character has on right now. Its "exposure" (e.g. completely naked, topless, barefoot) is literal: describe and react to it accordingly.
- "condition" is one of: [[CONDITIONS]]
- A new character also gets "wardrobe": 4-8 fitting items as [{"name": "...", "slots": ["..."]}], and "outfit": {"wear": ["item name", ...]} for what they wear now. Slots: [[SLOTS]]`;

const DEFAULT_SPEAKER_RULE = `Speaker blocks (mandatory in every reply):
- Everything a character does or says goes inside <npc id="ID">...</npc>: their actions, the narration about them, and all of their dialogue. Use their exact id from the scene.
- Open a new block every time the focus moves to another character. Only narration that belongs to no character (setting, weather, time passing) may stand outside a block. Never nest blocks.
- Write dialogue in plain double quotes, without HTML or font tags.
- A reply without speaker blocks is wrong. Example of a correct reply (the ids are examples):
The fire crackles in the hearth.
<npc id="ada">Ada sets down the kettle. "You should rest."</npc>
<npc id="bram">Bram folds his arms. "He's fine."</npc>`;

const DEFAULT_SPEAKER_REMINDER = `[Reminder: put each character's part of this reply inside <npc id="ID">...</npc>. Characters in the scene: [[IDS]]. Only narration that belongs to no one stays outside the blocks.]`;

const DEFAULT_ASSIST_CARD_PROMPT = `You help write character cards for NPCs in a roleplay.
- Write only the fields you are asked for, in the language of the request.
- Keep every value consistent with the current card unless the request says otherwise.
- Be concrete and specific; avoid clichés and purple prose.
- Answer with one JSON object and nothing else.`;

const DEFAULT_ASSIST_WARDROBE_PROMPT = `You help build wardrobes for characters in a roleplay.
- Suggest clothing that fits the character (culture, era, job, personality, budget) and the request.
- Give each item a plain, specific name with color or material, e.g. "Green wool dress".
- Each item covers one or more body slots; a dress covers upper_outer and lower_outer, a jumpsuit too.
- Answer with one JSON object and nothing else.`;

const DEFAULT_PORTRAIT_LLM_PROMPT = `Describe {{name}}'s portrait for an image generator. Use the template below.

STEP 1 – Fill every field in your reasoning.
Source for each field: the CHARACTER DATA and LATEST STORY MESSAGES provided below only.
If a field is not stated in the sources, write NONE, except SPECIES: if not stated, write human.

TEMPLATE
GENDER_TAG: 1girl or 1boy
SPECIES: e.g. human, elf (from race)
AGE: number + "years old"
FIGURE: 1 to 2 of: slender, petite, athletic, curvy, heavy
SKIN: color + "skin"
HAIR: length + color + "hair"
HAIRSTYLE: e.g. ponytail, loose, bun
EYES: color + "eyes"
FACE: 1 to 2 literal facial features if stated (e.g. freckles, beard, scar)
CLOTHING: upper-body items worn right now (from "Wearing right now"), each as color + material + item
ACCESSORIES: glasses, jewelry, hats etc. worn right now
EXPRESSION: one word
SETTING: 1 to 3 words

STEP 2 – Check every field.
- Is it stated in the sources? If not, change it to NONE.
- Does it follow the field's format? If not, fix it.
- Is it a literal visual word? No metaphors, no names, no personality, no actions.

STEP 3 – Output.
Join the fields in template order with ", ".
Remove every NONE field.
Output only that line.`;

const DEFAULT_PORTRAIT_LLM_PROMPT_V1 = `Describe {{name}} for an image generator. Use the template below.

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

/** Concrete example values for the tracking prompt (smaller models copy "..." literally). */
const TRAIT_SAMPLES = { race: 'human', species: 'human', age: '41', gender: 'female', sex: 'female', role: 'herbalist', job: 'herbalist', occupation: 'herbalist', class: 'commoner' };

const DEFAULT_USER_RULE = `- When [[USER]]'s posture or clothing changes, add {"id": "user"} with only what changed ("posture" from the list above, "outfit" with items from [[USER]]'s wardrobe). Never give [[USER]] a state or feelings.`;

const DEFAULTS = {
    enabled: true,
    injectMode: 'pm', // 'pm' = Prompt Manager entries / macros, 'auto' = extension prompt with depth
    scenePosition: 1, sceneDepth: 2, sceneRole: 0,
    instrPosition: 1, instrDepth: 0, instrRole: 0,
    instructions: DEFAULT_INSTRUCTIONS,
    sceneHeader: '',
    personaInUser: true,
    includeLibrary: true,
    threshold: 50,
    numericTolerance: 2,
    autoCreate: true,
    trackChar: true,
    traitKeys: ['race', 'age', 'gender', 'role'],
    postures: ['Standing', 'Sitting', 'Lying down', 'Kneeling', 'Crouching', 'Leaning', 'Walking', 'Running'],
    states: ['Calm', 'Happy', 'Amused', 'Excited', 'Curious', 'Suspicious', 'Determined', 'Stern', 'Annoyed', 'Angry', 'Nervous', 'Embarrassed', 'Afraid', 'Sad', 'Tired', 'Injured', 'Asleep', 'Unconscious'],
    rosterCollapsed: false,
    trackUser: true,
    speakerPortraits: true,
    speakerPortraitSize: 40,
    autoPortraits: true,
    portraitPrompt: 'portrait of {{name}}, head and shoulders, {{traits}}, {{details}}',
    portraitMode: 'llm',
    portraitFraming: true,
    portraitPrefix: 'solo, portrait, head and shoulders, upper body, looking at viewer, face in frame, centered',
    portraitNegative: 'close-up, extreme close-up, cropped head, head out of frame, partial face, cut off, multiple people, text, watermark',
    portraitLlmPrompt: DEFAULT_PORTRAIT_LLM_PROMPT,
    dialogueColors: true,
    describeExposure: true,
    speakerRule: DEFAULT_SPEAKER_RULE,
    speakerReminder: DEFAULT_SPEAKER_REMINDER,
    trackOutfits: true,
    includeWardrobe: true,
    allowWardrobeGrowth: false,
    wardrobeDollCollapsed: false,
    folders: [],
    folderCollapsed: [],
    autoFolder: '',
    assistCardPrompt: DEFAULT_ASSIST_CARD_PROMPT,
    assistWardrobePrompt: DEFAULT_ASSIST_WARDROBE_PROMPT,
    outfitRules: DEFAULT_OUTFIT_RULES,
    conditions: ['Worn', 'Loosened', 'Disheveled', 'Wet', 'Dirty', 'Bloody', 'Torn'],
    personas: {},
    library: {},
};

/** Sister extensions registered through window.NPCBook.registerExtension(). */
const extensions = new Map();

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
    if (s.sceneHeader === '[NPCs present in the scene]') s.sceneHeader = '';
    if (typeof s.outfitRules === 'string' && !s.outfitRules.includes('exposure') && s.outfitRules.includes('- Pick clothing that fits the situation (e.g. sleepwear for bed, then a day outfit after waking).')) {
        s.outfitRules = s.outfitRules.replace('- Pick clothing that fits the situation (e.g. sleepwear for bed, then a day outfit after waking).', '- Pick clothing that fits the situation (e.g. sleepwear for bed, then a day outfit after waking).\n- <wearing> is what each character has on RIGHT NOW. Its "exposure" (e.g. completely naked, topless, barefoot) is literal: describe and react to it accordingly.');
    }
    if (JSON.stringify(s.traitKeys) === JSON.stringify(['age', 'gender', 'role'])) s.traitKeys = ['race', 'age', 'gender', 'role'];
    if (!s.portraitTemplateV2 && s.portraitLlmPrompt === DEFAULT_PORTRAIT_LLM_PROMPT_V1) s.portraitLlmPrompt = DEFAULT_PORTRAIT_LLM_PROMPT;
    s.portraitTemplateV2 = true;
    if (typeof s.instructions === 'string' && !s.instructions.includes('"sexual_experience"')) {
        s.instructions = s.instructions.replace(
            'plus "description" (one line) and "details" (full profile: appearance, personality, background, manner of speech).',
            'plus "description" (one line), "details" (full profile: appearance, personality, background, manner of speech), "height", "pronouns" and "sexual_experience".',
        );
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
    const outfit = outfitFromDefault(p.defaultWorn, p.wardrobe, s.conditions);
    return { persona: personaKey(), posture: prev?.posture ?? s.postures[0] ?? '', outfit, dressed: outfit.length > 0 };
}
/**
 * Make a stored user state usable for the current persona.
 * An empty outfit that was never deliberately set ("dressed" false/missing) falls back to the starting outfit,
 * so chats saved before the persona's wardrobe existed don't report "nothing".
 */
function adaptUser(u) {
    if (!u || u.persona !== personaKey()) return freshUser(u);
    if (!u.dressed && !(u.outfit || []).length) {
        const f = freshUser(u);
        if (f.outfit.length) return { ...u, outfit: f.outfit, dressed: true };
    }
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

/** Profile fields of a card; pronouns fall back to the gender default when empty. */
function profileOf(t) {
    return {
        height: String(t?.height ?? '').trim(),
        pronouns: String(t?.pronouns ?? '').trim() || defaultPronouns(t?.traits?.gender),
        sexuality: String(t?.sexuality ?? '').trim(),
        sexualExperience: String(t?.sexualExperience ?? '').trim(),
    };
}

function traitSummary(t) {
    const tr = t?.traits || {};
    return settings().traitKeys.map(k => tr[k]).filter(v => v && String(v).trim()).join(', ');
}

// ───────────────────────── prompt text ─────────────────────────

const SLOT_LABEL = Object.fromEntries(SLOTS.map(x => [x.key, x.label]));

function xa(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function xt(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function indent(text, n) { const pad = ' '.repeat(n); return String(text).split('\n').map(l => (l ? pad + l : l)).join('\n'); }

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

function personaDescription() {
    const c = ctx();
    const raw = c.powerUserSettings?.persona_description || '';
    try { return c.substituteParams ? c.substituteParams(raw) : raw; } catch { return raw; }
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

function buildCharBlock(inst) {
    const s = settings();
    const t = templateFor(inst);
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

function buildSceneText() {
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

function extInstructions() {
    const out = [];
    for (const ext of extensions.values()) {
        if (typeof ext.instructions !== 'function') continue;
        try { const t = ext.instructions({ autoCreate: settings().autoCreate }); if (t) out.push(String(t)); } catch (e) { console.warn(e); }
    }
    return out;
}

function buildInstructionText() {
    const s = settings();
    if (!s.enabled || !hasChat()) return '';
    const c = ctx();
    const keys = s.traitKeys.length ? s.traitKeys : ['race', 'age', 'gender', 'role'];
    const libLines = s.includeLibrary
        ? Object.values(lib()).sort((a, b) => a.name.localeCompare(b.name)).map(t => {
            const tr = traitSummary(t);
            return `${t.id}: ${t.name}${tr ? ` — ${tr}` : ''}`;
        })
        : [];
    return String(s.instructions || '')
        .replaceAll('[[SPEAKER_RULE]]', s.enabled && s.speakerPortraits ? s.speakerRule : '')
        .replaceAll('[[OUTFIT_RULES]]', [s.trackOutfits ? s.outfitRules : '', s.trackUser ? DEFAULT_USER_RULE : '', ...extInstructions()].filter(Boolean).join('\n'))
        .replaceAll('[[USER_EXAMPLE]]', s.trackUser ? `,\n  {"id": "user", "posture": "${s.postures[1] ?? s.postures[0] ?? 'Sitting'}"}` : '')
        .replaceAll('[[CONDITIONS]]', s.conditions.join(', '))
        .replaceAll('[[SLOTS]]', SLOTS.map(x => x.key).join(', '))
        .replaceAll('[[EXCLUDE]]', excludedNames().join(' and ') || 'the user')
        .replaceAll('[[USER]]', c.name1 || 'the user')
        .replaceAll('[[CHAR]]', c.name2 || 'the main character')
        .replaceAll('[[POSTURES]]', s.postures.join(', '))
        .replaceAll('[[STATES]]', s.states.join(', '))
        .replaceAll('[[TRAIT_KEYS]]', keys.join(', '))
        .replaceAll('[[TRAIT_EXAMPLE]]', keys.map(k => `"${k}": "${TRAIT_SAMPLES[normalize(k)] ?? 'unknown'}"`).join(', '))
        .replaceAll('[[LIBRARY]]', libLines.length ? libLines.join('\n') : '(none yet)');
}

function updateAutoInjection() {
    const c = ctx();
    const s = settings();
    const auto = s.enabled && s.injectMode === 'auto';
    c.setExtensionPrompt(INJECT_SCENE_KEY, auto ? buildSceneText() : '', Number(s.scenePosition), Number(s.sceneDepth), false, Number(s.sceneRole));
    c.setExtensionPrompt(INJECT_INSTR_KEY, auto ? buildInstructionText() : '', Number(s.instrPosition), Number(s.instrDepth), false, Number(s.instrRole));
    // Short speaker-block reminder right before the reply (in chat, depth 0), in both injection modes.
    c.setExtensionPrompt(INJECT_REMIND_KEY, buildSpeakerReminder(), 1, 0, false, 0);
}

/** Ids of the characters the next reply may voice: the scene, plus the main character when it is tracked. */
function speakerIds() {
    const c = ctx();
    const ids = promptRoster().map(i => i.id);
    if (settings().trackChar && c.characterId !== undefined && !c.groupId && c.name2) {
        const id = resolveRef(c.name2, lib());
        if (id && !ids.includes(id)) ids.unshift(id);
    }
    return ids;
}

function buildSpeakerReminder() {
    const s = settings();
    const text = String(s.speakerReminder || '').trim();
    if (!s.enabled || !s.speakerPortraits || !text || !hasChat()) return '';
    const ids = speakerIds();
    return ids.length ? text.replaceAll('[[IDS]]', ids.join(', ')) : '';
}

function registerMacros() {
    const c = ctx();
    const defs = [
        ['npcScene', 'NPC Book: details + live state of NPCs present in this chat (empty if none).', buildSceneText],
        ['npcInstructions', 'NPC Book: tracking instructions for the LLM.', buildInstructionText],
    ];
    // Never let a macro fail silently: log the error and show one toast per macro per session.
    const warned = new Set();
    const safe = (name, fn) => () => {
        try { return fn(); } catch (e) {
            console.error(`[NPC Book] {{${name}}} failed`, e);
            if (!warned.has(name)) { warned.add(name); toastr.error(`{{${name}}} failed: ${e?.message || e}. See browser console.`, 'NPC Book'); }
            return '';
        }
    };
    for (const [name, description, fn] of defs) {
        const handler = safe(name, fn);
        try {
            if (c.macros?.register) c.macros.register(name, { category: 'NPC Book', description, handler });
            else c.registerMacro(name, handler, description);
        } catch (e) {
            try { c.registerMacro(name, handler, description); } catch (e2) { console.error('[NPC Book] macro registration failed', e2); }
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

/** True when no user message comes before chat[idx] (i.e. it is a greeting / intro message). */
function isGreetingIdx(idx) {
    const chat = ctx().chat || [];
    return idx >= 0 && chat.slice(0, idx).every(x => !x.is_user);
}

function newInstance(id) {
    const s = settings();
    const t = lib()[id];
    return { id, name: t.name, posture: s.postures[0] ?? '', state: s.states[0] ?? '', feelings: '', outfit: outfitFromDefault(t.defaultWorn, t.wardrobe || [], s.conditions) };
}

/**
 * Starting cast for regenerating a greeting: the given roster, plus the cast read from the greeting's
 * "characters" block (any swipe), plus the main character card when "Track the main character" is on.
 */
function greetingCast(idx, base) {
    const s = settings();
    const c = ctx();
    const msg = (c.chat || [])[idx];
    const roster = clone(base || []);
    const has = (id) => roster.some(x => x.id === id);
    const snaps = [snapOf(msg), ...(Array.isArray(msg?.swipe_info) ? msg.swipe_info.map(si => si?.extra?.[MODULE]) : [])].filter(Boolean);
    const greet = snaps.find(x => x.greeting && Array.isArray(x.post) && x.post.length);
    for (const inst of greet?.post || []) if (inst?.id && !has(inst.id)) roster.push(clone(inst));
    const assistantMode = c.characterId === undefined && !c.groupId;
    if (s.trackChar && !assistantMode && !c.groupId && c.name2) {
        const id = resolveRef(c.name2, lib());
        if (id && !has(id)) roster.push(newInstance(id));
    }
    return roster;
}

function onGenerationStarted(type, _opts, dryRun) {
    if (dryRun) { updateAutoInjection(); return; }
    const chat = ctx().chat || [];
    if (type === 'quiet' || type === 'impersonate') { updateAutoInjection(); return; }
    const lastIdx = chat.length - 1;
    const last = chat[lastIdx];
    if ((type === 'swipe' || type === 'continue') && last && !last.is_user) {
        const m = meta();
        const metaHit = m?.pre && m.pre.idx === lastIdx;
        let pre = metaHit ? m.pre.roster : (snapOf(last)?.pre ?? rosterBefore(lastIdx));
        // Regenerating a greeting: the scene "before" it is empty, so seed it with the greeting's cast + the main character card.
        if (isGreetingIdx(lastIdx)) pre = greetingCast(lastIdx, pre);
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
    let processed = null;
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
                        if (userEntry.outfit || userEntry.wear) u.dressed = true;
                    }
                    postUser = u;
                }
                // The block lists changes, so apply it to the scene as it stood before this text was written.
                const r = applyTracker(ex.json.filter(e => !isUserEntry(e)), post, {
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
                for (const t of r.created) {
                    t.color = t.color || pickColor();
                    t.folder = normFolder(s.autoFolder);
                    registerFolder(t.folder);
                    const entry = ex.json.find(e => e && normalize(e.name) === normalize(t.name));
                    for (const ext of extensions.values()) {
                        if (typeof ext.fromTracker !== 'function' || !entry) continue;
                        try { const d = ext.fromTracker(entry, t); if (d) { t.ext = t.ext || {}; t.ext[ext.id] = d; } } catch (e) { console.warn(`[NPC Book] ${ext.id} fromTracker failed`, e); }
                    }
                    lib()[t.id] = t;
                }
                for (const t of r.updated || []) lib()[t.id] = t;
                if (r.updated?.length) save();
                if (r.created.length) {
                    save();
                    toastr.info(`New NPC${r.created.length > 1 ? 's' : ''}: ${r.created.map(t => `${t.name} (${t.id})`).join(', ')}`, 'NPC Book');
                    renderLibraryList();
                }
                post = r.roster;
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
        processed = { idx, swipeId: msg.swipe_id ?? 0, type: g.type || 'normal' };
    } catch (e) {
        console.error('[NPC Book] processing failed', e);
    } finally {
        processing = false;
        renderRoster();
    }
    // Tell sister extensions (e.g. TTS) that this message is final: tracker block removed, scene saved.
    if (processed) document.dispatchEvent(new CustomEvent('npcbook:message', { detail: processed }));
}

// ───────────────────────── first message: starting cast ─────────────────────────

/**
 * Reads a `{"characters": [{"id": ..., overrides}]}` JSON block from the greeting(s) at the start of the chat and puts them in the scene.
 * Overrides (posture, state, feelings, clothing / slot keys) replace the card defaults for this intro only.
 */
async function processGreetings() {
    const s = settings();
    if (!s.enabled || !hasChat()) return;
    const c = ctx();
    const chat = c.chat || [];
    let changed = false;
    let carried = meta()?.base ?? [];
    const notes = { missing: new Set(), added: [], warnings: new Set(), errors: new Set() };
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
            if (ex.error) { console.warn('[NPC Book] intro cast block:', ex.error); notes.errors.add(ex.error); }
            if (ex.cleaned === texts[k]) continue; // block could not be read and was left in place
            const preUser = userBefore(i);
            const cast = applyIntroCast(ex.entries, carried, preUser, notes);
            const snap = { pre: clone(carried), post: clone(cast.roster), preUser: clone(preUser), postUser: clone(cast.user), raw: null, sig: sig(ex.cleaned), greeting: true };
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
    if (notes.missing.size) toastr.warning(`Not in the NPC Library: ${[...notes.missing].join(', ')}`, 'NPC Book');
    if (notes.errors.size) toastr.error(`Could not read the intro characters block: ${[...notes.errors].join('; ')}`, 'NPC Book');
    if (notes.warnings.size) {
        console.warn('[NPC Book] intro cast:', [...notes.warnings]);
        toastr.warning([...notes.warnings].map(esc).join('<br>'), 'NPC Book: intro cast', { escapeHtml: false });
    }
    if (notes.added.length) {
        save();
        toastr.info(`Added to wardrobe: ${notes.added.join('; ')}`, 'NPC Book');
    }
    if (changed) {
        await c.saveChat?.();
        renderRoster();
        decorateAll();
    }
}

function isUserRef(ref) {
    const n = normalize(ref);
    const name1 = normalize(ctx().name1);
    return ['user', 'you', 'persona'].includes(n) || (!!name1 && n === name1 && !lib()[String(ref).trim().toLowerCase()]);
}

/**
 * Build the scene for an intro message from its cast entries [{ref, overrides}].
 * Each NPC starts from its card (default outfit, first posture/state); overrides replace parts of that.
 * Clothing named in an override but missing from the wardrobe is added to the card's wardrobe.
 */
function applyIntroCast(entries, carried, user, notes) {
    const s = settings();
    const opts = { postures: s.postures, states: s.states, conditions: s.conditions };
    const roster = clone(carried);
    let u = clone(user);
    for (const e of entries || []) {
        if (isUserRef(e.ref)) {
            const p = personaData();
            const r = applyCastOverrides({ posture: u.posture, outfit: u.outfit || [] }, e.overrides, { ...opts, wardrobe: p.wardrobe });
            const outfitChanged = JSON.stringify(r.instance.outfit) !== JSON.stringify(u.outfit || []);
            u = { ...u, posture: r.instance.posture, outfit: r.instance.outfit, dressed: u.dressed || outfitChanged };
            if (r.added.length) { p.wardrobe = r.wardrobe; notes.added.push(`${ctx().name1}: ${r.added.map(x => x.name).join(', ')}`); }
            r.warnings.forEach(w => notes.warnings.add(`${ctx().name1}: ${w}`));
            continue;
        }
        const id = resolveRef(e.ref, lib());
        if (!id) { notes.missing.add(e.ref); continue; }
        const t = lib()[id];
        let inst = roster.find(x => x.id === id);
        if (!inst) { inst = newInstance(id); roster.push(inst); }
        const r = applyCastOverrides(inst, e.overrides, { ...opts, wardrobe: t.wardrobe || [] });
        Object.assign(inst, r.instance);
        if (r.added.length) { t.wardrobe = r.wardrobe; notes.added.push(`${t.name}: ${r.added.map(x => x.name).join(', ')}`); }
        r.warnings.forEach(w => notes.warnings.add(`${t.name}: ${w}`));
    }
    return { roster, user: u };
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
    const labeled = settings().traitKeys.map(k => (t.traits?.[k] ? `${k}: ${t.traits[k]}` : null)).filter(Boolean).join('; ');
    return {
        name: t.name,
        identity: labeled,
        height: profileOf(t).height,
        description: String(t.description || '').trim(),
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

/** Always frame as a portrait: drop close-up tags, put the portrait prefix first, de-duplicate tags. */
function framePortrait(line) {
    const s = settings();
    if (!s.portraitFraming) return line;
    const tags = [...String(s.portraitPrefix || '').split(','), ...String(line || '').split(',')]
        .map(x => x.trim())
        .filter(x => x && !/\b(extreme\s+)?close[\s-]?up\b/i.test(x));
    const seen = new Set();
    return tags.filter(x => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).join(', ');
}

async function portraitPromptFor(t) {
    const s = settings();
    const d = portraitData(t);
    if (s.portraitMode !== 'llm') return framePortrait(cleanForImagine(fillPortraitTemplate(s.portraitPrompt, { ...d, details: d.details.slice(0, 400) })));
    const system = fillPortraitTemplate(s.portraitLlmPrompt, d);
    const data = [
        'CHARACTER DATA',
        `Name: ${d.name}`,
        d.identity && `Identity: ${d.identity}`,
        d.height && `Height: ${d.height}`,
        d.details && `Details: ${d.details}`,
        d.description && `Notes: ${d.description}`,
        d.outfit && `Wearing right now: ${d.outfit}`,
        d.posture && `Posture: ${d.posture}`,
        d.state && `State: ${d.state}`,
        '',
        'LATEST STORY MESSAGES',
        recentStory() || '(none)',
    ].filter(x => typeof x === 'string').join('\n');
    const answer = await ctx().generateRaw({ systemPrompt: system, prompt: `${data}\n\nFollow the instructions and output only the final line.` });
    const line = framePortrait(cleanForImagine(extractTagLine(answer)));
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
                const neg = cleanForImagine(settings().portraitFraming ? settings().portraitNegative : '');
                const negArg = neg ? ` negative="${neg}"` : '';
                const res = await ctx().executeSlashCommandsWithOptions(`/imagine quiet=true gallery=false extend=false edit=false${negArg} "${prompt}"`, { handleParserErrors: false, handleExecutionErrors: false });
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

/*
 * Speaker blocks: the LLM wraps each character's part of a reply in <npc id="ID">...</npc>.
 * Through SillyTavern's message formatter each block becomes a card around the rendered Markdown:
 *   <div data-npcb-turn="ID"><div data-npcb-ava></div><div data-npcb-body>…</div></div> The tags are swapped for plain-text markers before Markdown runs (so the content inside is
 * formatted normally), and the markers are turned into the divs afterwards. The stored message keeps the tags.
 */
const TURN_OPEN_RE = /<npc\s+id\s*=\s*["']?([^"'>\s]+)["']?\s*>/gi;
const TURN_CLOSE_RE = /<\/npc\s*>/gi;
const TURN_PARTIAL_RE = /<\/?n(?:p(?:c(?:\s[^>]*)?)?)?$/i; // half-streamed tag at the very end
const toHex = (str) => Array.from(new TextEncoder().encode(str), b => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new TextDecoder().decode(new Uint8Array(hex.match(/../g).map(x => parseInt(x, 16))));
const turnDiv = (hex) => `<div data-npcb-turn="${xa(fromHex(hex))}"><div data-npcb-ava></div><div data-npcb-body>`;
const TURN_END = '</div></div>';

function registerTurnFormatter() {
    const mf = ctx().messageFormatter;
    if (!mf?.addHook) {
        console.warn('[NPC Book] this SillyTavern version has no message formatter; <npc> speaker blocks are not rendered.');
        return;
    }
    mf.addHook((mes, info) => {
        if (info.isUser || info.isReasoning) return mes;
        return mes
            .replace(TURN_PARTIAL_RE, '')
            .replace(TURN_OPEN_RE, (_, id) => `\n\nXNPCBO${toHex(id)}X\n\n`)
            .replace(TURN_CLOSE_RE, '\n\nXNPCBCX\n\n');
    }, { stage: mf.stage.BEFORE_REGEX, order: mf.order.EARLY });
    mf.addHook((html) => {
        if (!html.includes('XNPCB')) return html;
        return html
            .replace(/<p>\s*XNPCBO([0-9a-f]+)X\s*<\/p>/g, (_, h) => turnDiv(h))
            .replace(/<p>\s*XNPCBCX\s*<\/p>/g, TURN_END)
            .replace(/XNPCBO([0-9a-f]+)X/g, (_, h) => turnDiv(h))
            .replace(/XNPCBCX/g, TURN_END);
    }, { stage: mf.stage.AFTER_MARKDOWN, order: mf.order.LATE });
}

function rosterAtMessage(idx) {
    const chat = ctx().chat || [];
    for (let i = Math.min(idx, chat.length - 1); i >= 0; i--) {
        const sn = snapOf(chat[i]);
        if (sn && Array.isArray(sn.post)) return i === idx && sn.pre ? [...new Set([...sn.pre, ...sn.post].map(x => x.id))] : sn.post.map(x => x.id);
    }
    return [];
}

/** Fill the avatar box of a speaker card (portrait, or initials when there is none) and set its accent color. */
function decorateTurn(turn) {
    const ava = turn.querySelector(':scope > [data-npcb-ava]');
    if (!ava) return;
    const raw = turn.getAttribute('data-npcb-turn') || '';
    const id = resolveRef(raw, lib());
    const t = id ? lib()[id] : null;
    if (t && !t.portrait) ensurePortrait(id);
    const key = `${id}|${t?.portrait || ''}|${t?.color || ''}|${t?.name || ''}`;
    if (ava.dataset.npcbKey === key) return;
    ava.dataset.npcbKey = key;
    ava.title = t?.name || raw;
    if (t?.portrait) {
        ava.style.backgroundImage = `url(${JSON.stringify(t.portrait)})`;
        ava.textContent = '';
    } else {
        ava.style.backgroundImage = '';
        ava.textContent = initials(t?.name || raw);
    }
    const color = normColor(t?.color);
    if (color) turn.style.setProperty('--npcb-c', color); else turn.style.removeProperty('--npcb-c');
    turn.classList.toggle('npcb-colored', !!color);
}

/** Card on/off and avatar size, applied through CSS so themes can't override them. */
function applyCardStyle() {
    const s = settings();
    const size = Math.min(200, Math.max(16, Number(s.speakerPortraitSize) || 40));
    document.documentElement.style.setProperty('--npcb-ava-size', `${size}px`);
    $('#chat').toggleClass('npcb-cards-off', !(s.enabled && s.speakerPortraits))
        .toggleClass('npcb-colors-off', !(s.enabled && s.dialogueColors));
}

function decorateMessage(mesid) {
    const textEl = document.querySelector(`#chat .mes[mesid="${mesid}"] .mes_text`);
    if (!textEl) return;
    for (const turn of textEl.querySelectorAll('div[data-npcb-turn]')) decorateTurn(turn);
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
    const itemHtml = (t, depth, showPath) => `
            <div class="npcb-picker-item" data-id="${esc(t.id)}" style="padding-left:${4 + depth * 14}px">${avatarHtml(t, t.name, 'npcb-ava-sm')}
                <div><div>${esc(t.name)} <small class="npcb-dim">${esc(showPath && t.folder ? `${t.folder} · ${t.id}` : t.id)}</small></div><small class="npcb-dim">${esc(traitSummary(t) || t.description || '')}</small></div>
            </div>`;
    const draw = () => {
        const nq = normalize(pop.find('.npcb-picker-search').val());
        const byName = (a, b) => a.name.localeCompare(b.name);
        const avail = Object.values(lib()).filter(t => !present.has(t.id));
        const list = pop.find('.npcb-picker-list');
        if (nq) {
            const hits = avail.filter(t => normalize(`${t.name} ${t.id} ${t.description} ${t.folder || ''}`).includes(nq)).sort(byName);
            list.html(hits.length ? hits.map(t => itemHtml(t, 0, true)).join('') : '<div class="npcb-empty">No matching NPCs.</div>');
            return;
        }
        if (!avail.length) { list.html('<div class="npcb-empty">Everyone is already in the scene.</div>'); return; }
        // Same folders (and the same open / closed state) as the NPC Library; folders with nobody left to add are hidden.
        const collapsed = new Set(settings().folderCollapsed);
        const countIn = (path) => avail.filter(t => inFolder(normFolder(t.folder), path)).length;
        const folders = allFolders().filter(f => countIn(f) > 0);
        const tree = (parent, depth) => {
            let html = '';
            for (const f of folders.filter(x => folderParent(x) === parent)) {
                const open = !collapsed.has(f);
                html += `<div class="npcb-lib-folder npcb-picker-folder" data-path="${esc(f)}" style="padding-left:${4 + depth * 14}px">
                    <i class="fa-solid fa-chevron-${open ? 'down' : 'right'} npcb-lib-fchev"></i><i class="fa-solid fa-folder${open ? '-open' : ''}"></i>
                    <span class="npcb-lib-fname">${esc(f.split('/').pop())}</span><small class="npcb-dim">${countIn(f)}</small></div>`;
                if (open) html += tree(f, depth + 1);
            }
            return html + avail.filter(t => normFolder(t.folder) === parent).sort(byName).map(t => itemHtml(t, depth, false)).join('');
        };
        list.html(tree('', 0));
    };
    draw();
    pop.on('input', '.npcb-picker-search', draw);
    pop.on('click', '.npcb-picker-folder', (e) => {
        const s = settings();
        const path = String($(e.currentTarget).data('path'));
        s.folderCollapsed = s.folderCollapsed.includes(path) ? s.folderCollapsed.filter(f => f !== path) : [...s.folderCollapsed, path];
        save();
        draw();
        renderLibraryList();
    });
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
        ${t ? `<div class="npcb-row">${[...extensions.values()].filter(x => x.cardTab).map(x => `<div class="menu_button npcb-i-ext" data-ext="${esc(x.id)}"><i class="fa-solid ${esc(x.personaSheet?.icon || x.cardTab.icon || 'fa-table-list')}"></i> ${esc(x.sheetLabel || `${x.cardTab.label || x.id} sheet`)}</div>`).join('')}</div>` : ''}
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
    pop.on('click', '.npcb-i-ext', (e) => { const x = $(e.currentTarget).data('ext'); closePopovers(); openTemplateExtSheet(id, x); });
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
                ${fits.length > 8 ? '<input type="search" class="text_pole npcb-slot-search" placeholder="Search…">' : ''}
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
    host.on('input.doll', '.npcb-slot-search', (e) => {
        const q = normalize(e.target.value);
        host.find('.npcb-slot-opt').each((_, el) => { $(el).toggle(!q || normalize($(el).text()).includes(q)); });
    });
    draw();
}

const wardrobeUi = new Map(); // per owner (NPC id / persona key), this session: { open: Set<slot> } of unfolded groups
const GROUP_FOLD = 5;
const SLOT_SHORT = { head: 'Head', hair: 'Hair', face: 'Face', glasses: 'Glasses', piercings: 'Piercings', neck: 'Neck', cover: 'Cover', upper_outer: 'Upper', upper_inner: 'Upper inner', hands: 'Hands', waist: 'Waist', lower_outer: 'Lower', lower_inner: 'Lower inner', feet_outer: 'Feet', feet_inner: 'Feet inner', other: 'Other' };
const slotIndex = (k) => SLOTS.findIndex(x => x.key === k);
const primarySlot = (item) => [...(item.slots || [])].sort((a, b) => slotIndex(a) - slotIndex(b))[0] || 'other';

/**
 * Wardrobe editor: collapsible starting-outfit doll on the left, compact item list on the right
 * (grouped by slot, search, filters, sort, inline item editor, bulk actions, quick add).
 * Mutates data = { wardrobe: [], defaultWorn: [] } in place. Returns { refresh }.
 */
function mountWardrobe(host, data, { key = '', onChange } = {}) {
    const s = settings();
    if (!wardrobeUi.has(key)) wardrobeUi.set(key, { open: new Set() });
    const ui = wardrobeUi.get(key);
    const st = { q: '', slot: '', starOnly: false, sort: 'slot', expanded: null, selected: new Set() };
    host.html(`<div class="npcb-wdx ${s.wardrobeDollCollapsed ? 'npcb-doll-collapsed' : ''}">
        <div class="npcb-wdx-doll">
            <div class="npcb-wdx-dollhead"><span>Starting outfit</span><i class="fa-solid fa-angles-left npcb-wdx-dolltoggle" title="Hide starting outfit"></i></div>
            <div class="npcb-wdx-grid"></div>
            <small class="npcb-dim npcb-wdx-hint"></small>
        </div>
        <div class="npcb-wdx-list">
            <div class="npcb-wdx-tb">
                <i class="fa-solid fa-angles-right npcb-wdx-dollshow" title="Show starting outfit"></i>
                <input type="search" class="text_pole npcb-wdx-q" placeholder="Search…">
                <select class="text_pole npcb-wdx-slot"><option value="">All slots</option>${SLOTS.map(x => `<option value="${x.key}">${esc(x.label)}</option>`).join('')}</select>
                <span class="npcb-chip npcb-wdx-staronly" title="Only items worn at the start">★</span>
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
            <span class="npcb-wdx-star ${isStar(it.id) ? 'on' : ''}" title="Worn at the start">★</span>
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
            <div class="menu_button npcb-wdx-bulkstar">★ Starting</div>
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
        if (st.slot && !$(e.target).is('.npcb-wdx-dots')) {
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
        <div class="npcb-row"><div class="menu_button npcb-u-save"><i class="fa-solid fa-check"></i> Save</div>
        ${[...extensions.values()].filter(x => x.personaSheet).map(x => `<div class="menu_button npcb-u-ext" data-ext="${esc(x.id)}"><i class="fa-solid ${esc(x.personaSheet.icon || 'fa-table-list')}"></i> ${esc(x.personaSheet.label || x.id)}</div>`).join('')}</div>
    </div>`);
    pop.on('click', '.npcb-u-ext', (e) => { const id = $(e.currentTarget).data('ext'); closePopovers(); openPersonaCharacter(`ext:${id}`); });
    pop.on('click', e => e.stopPropagation());
    let draft = u.outfit;
    mountPaperdoll(pop.find('.npcb-doll-host'), () => draft, (o) => { draft = o; }, () => personaData().wardrobe, () => { closePopovers(); openPersonaCharacter('wardrobe'); });
    pop.on('click', '.npcb-u-save', () => {
        writeCurrentRoster(null, { ...u, posture: String(pop.find('.npcb-u-posture').val() ?? ''), outfit: draft, dressed: true });
        closePopovers();
    });
    placePopover(pop, anchor);
}

/** Persona character editor: wardrobe (with starting outfit) and every sister-extension sheet (e.g. GURPS), in one window. */
async function openPersonaCharacter(tab = 'wardrobe') {
    const c = ctx();
    const p = personaData();
    p.ext = p.ext || {};
    const draft = clone({ wardrobe: p.wardrobe, defaultWorn: p.defaultWorn, ext: p.ext });
    const extTabs = [...extensions.values()].filter(x => x.personaSheet);
    for (const x of extTabs) if (!draft.ext[x.id]) draft.ext[x.id] = typeof x.defaultData === 'function' ? x.defaultData() : {};
    if (!tab.startsWith('ext:')) tab = 'wardrobe';
    const ava = personaKey() ? `<img class="npcb-ava npcb-ava-md" src="${esc(getUserAvatar(personaKey()))}">` : avatarHtml(null, c.name1, 'npcb-ava-md');
    const box = $(`<div class="npcb-persona-char">
        <div class="npcb-inst-head">${ava}<div><b>${esc(c.name1)}</b><br><small class="npcb-dim">persona character · description, name and avatar come from Persona Management</small></div></div>
        <div class="npcb-tabs">
            <div class="npcb-tab ${tab === 'wardrobe' ? 'active' : ''}" data-tab="wardrobe">Wardrobe</div>
            ${extTabs.map(x => `<div class="npcb-tab ${tab === `ext:${x.id}` ? 'active' : ''}" data-tab="ext:${esc(x.id)}">${esc(x.personaSheet.label || x.id)}</div>`).join('')}
        </div>
        <div class="npcb-tabpane" data-pane="wardrobe" ${tab === 'wardrobe' ? '' : 'style="display:none"'}>
            <small class="npcb-dim">★ items are what you wear when a new chat starts (and when you switch to this persona).</small>
            <div class="npcb-wd-host"></div>
        </div>
        ${extTabs.map(x => `<div class="npcb-tabpane" data-pane="ext:${esc(x.id)}" ${tab === `ext:${x.id}` ? '' : 'style="display:none"'}><div class="npcb-ext-host" data-ext="${esc(x.id)}"></div></div>`).join('')}
    </div>`);
    bindTabs(box);
    mountWardrobe(box.find('.npcb-wd-host'), draft, { key: `persona:${personaKey()}` });
    for (const x of extTabs) {
        try { x.personaSheet.render(box.find(`.npcb-ext-host[data-ext="${x.id}"]`), { data: draft.ext[x.id], kind: 'user', name: c.name1 }); } catch (e) { console.error(e); }
    }
    const ok = await c.callGenericPopup(box, c.POPUP_TYPE.CONFIRM, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: 'Save', cancelButton: 'Cancel' });
    if (!ok) return;
    p.wardrobe = draft.wardrobe.filter(i => i.name.trim());
    p.defaultWorn = draft.defaultWorn.filter(id => p.wardrobe.some(i => i.id === id));
    p.ext = draft.ext;
    save();
    if (hasChat()) {
        const u = currentUser();
        let outfit = (u.outfit || []).filter(w => p.wardrobe.some(i => i.id === w.id));
        if (!outfit.length) outfit = outfitFromDefault(p.defaultWorn, p.wardrobe, settings().conditions);
        writeCurrentRoster(null, { ...u, outfit, dressed: outfit.length > 0 });
    }
    updateAutoInjection();
    toastr.success(`Saved ${c.name1}'s character.`, 'NPC Book');
}

function ensurePersonaButton() {
    const holder = $('#persona_connections_buttons');
    if (!holder.length || $('#npcb_persona_char').length) return;
    const btn = $(`<div id="npcb_persona_char" class="menu_button menu_button_icon" title="NPC Book: wardrobe, starting outfit and sheets (e.g. GURPS) for the selected persona">
        <i class="icon fa-solid fa-users-viewfinder fa-fw"></i><div>NPC Book</div></div>`);
    holder.append(btn);
    btn.on('click', () => openPersonaCharacter());
}

/** Open a sister-extension sheet (e.g. GURPS) of an NPC card in a popup; Save writes it to the card. */
async function openTemplateExtSheet(id, extId) {
    const c = ctx();
    const t = lib()[id];
    const x = extensions.get(extId);
    if (!t || !x?.cardTab) return;
    const data = clone(t.ext?.[extId] ?? (typeof x.defaultData === 'function' ? x.defaultData() : {}));
    const box = $(`<div class="npcb-ext-popup"><div class="npcb-inst-head">${avatarHtml(t, t.name, 'npcb-ava-md')}<div><b>${esc(t.name)}</b><br><small class="npcb-dim">${esc(t.id)} · ${esc(x.cardTab.label || x.id)}</small></div></div><div class="npcb-ext-host"></div></div>`);
    try { x.cardTab.render(box.find('.npcb-ext-host'), { data, template: t, isNew: false, kind: 'char' }); } catch (e) { console.error(e); }
    const ok = await c.callGenericPopup(box, c.POPUP_TYPE.CONFIRM, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: 'Save', cancelButton: 'Cancel' });
    if (!ok) return;
    const fresh = lib()[id];
    if (!fresh) return;
    fresh.ext = fresh.ext || {};
    fresh.ext[extId] = data;
    save();
    updateAutoInjection();
    if ($('#npcb_library').is(':visible') && libSelected === id) selectTemplate(id, false, `ext:${extId}`);
    toastr.success(`Saved ${t.name}'s ${x.cardTab.label || x.id} sheet.`, 'NPC Book');
}

// ───────────────────────── NPC Library (top bar) ─────────────────────────

let libSelected = null;
let libIsNew = false;
let libDraftPortrait = null;
let libDraftWardrobe = null;
let libWardrobeUi = null;
let libNewFolder = '';
let libDraftExt = {};
let libDraftDialogue = [];

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
              <div class="menu_button npcb-lib-newfolder" title="New folder"><i class="fa-solid fa-folder-plus"></i></div>
              <div class="menu_button npcb-lib-new" title="New NPC"><i class="fa-solid fa-plus"></i></div>
            </div>
            <div class="npcb-lib-list"></div>
          </div>
          <div class="npcb-lib-editor"></div>
          <div class="npcb-assist" style="display:none"></div>
        </div>
      </div>
    </div>`);
    $('body').append(modal);
    modal.on('click', (e) => { if (e.target === modal[0]) closeLibrary(); });
    modal.on('click', '.npcb-lib-close', closeLibrary);
    modal.on('click', '.npcb-lib-new', () => { libNewFolder = (libSelected && lib()[libSelected]?.folder) || ''; selectTemplate(null, true); });
    modal.on('click', '.npcb-lib-newfolder', async () => {
        const name = await askFolderName('New folder (use / for subfolders, e.g. <i>Eldoria/Village</i>):');
        if (!name) return;
        registerFolder(name);
        save(); renderLibraryList();
    });
    modal.on('click', '.npcb-lib-folder', (e) => {
        const path = String($(e.currentTarget).data('path'));
        if ($(e.target).is('.npcb-lib-fmenu')) { e.stopPropagation(); openFolderMenu(e.target, path); return; }
        const s = settings();
        s.folderCollapsed = s.folderCollapsed.includes(path) ? s.folderCollapsed.filter(f => f !== path) : [...s.folderCollapsed, path];
        save(); renderLibraryList();
    });
    // drag an NPC onto a folder (or onto empty list space for the top level)
    modal.on('dragstart', '.npcb-lib-item', (e) => { e.originalEvent.dataTransfer.setData('text/x-npcb-id', String($(e.currentTarget).data('id'))); e.originalEvent.dataTransfer.effectAllowed = 'move'; });
    modal.on('dragover', '.npcb-lib-folder, .npcb-lib-list', (e) => {
        if (![...(e.originalEvent.dataTransfer?.types || [])].includes('text/x-npcb-id')) return;
        e.preventDefault();
        e.stopPropagation();
        modal.find('.npcb-drop').removeClass('npcb-drop');
        $(e.currentTarget).addClass('npcb-drop');
    });
    modal.on('dragleave drop', '.npcb-lib-folder, .npcb-lib-list', (e) => { $(e.currentTarget).removeClass('npcb-drop'); });
    modal.on('drop', '.npcb-lib-folder, .npcb-lib-list', (e) => {
        const id = e.originalEvent.dataTransfer?.getData('text/x-npcb-id');
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        modal.find('.npcb-drop').removeClass('npcb-drop');
        moveNpcToFolder(id, $(e.currentTarget).is('.npcb-lib-folder') ? String($(e.currentTarget).data('path')) : '');
    });
    modal.on('input', '.npcb-lib-search', renderLibraryList);
    modal.on('click', '.npcb-lib-item', (e) => selectTemplate($(e.currentTarget).data('id')));
    modal.on('click', '.npcb-lib-export', exportLibrary);
    modal.on('click', '.npcb-lib-import', () => modal.find('.npcb-lib-import-file').trigger('click'));
    modal.on('change', '.npcb-lib-import-file', importLibrary);
    bindAssist(modal);
}

function openLibrary(id = null, isNew = false, tab = 'card') {
    ensureLibraryModal();
    $('#npcb_library').css('display', 'flex');
    renderLibraryList();
    const first = id ?? libSelected ?? Object.keys(lib()).sort()[0] ?? null;
    selectTemplate(isNew ? null : first, isNew || !first, tab);
}

function closeLibrary() { $('#npcb_library').hide(); }

// ── folders ──
/** "  Eldoria / Village/ " → "Eldoria/Village" ('' = no folder). */
function normFolder(path) {
    return String(path ?? '').split('/').map(x => x.trim()).filter(Boolean).join('/');
}
const folderParent = (path) => path.split('/').slice(0, -1).join('/');
const inFolder = (folder, path) => folder === path || folder.startsWith(`${path}/`);

/** Every folder that exists: saved ones, ones NPCs are in, and all their parents. */
function allFolders() {
    const out = new Set();
    const add = (p) => { p = normFolder(p); while (p) { out.add(p); p = folderParent(p); } };
    for (const f of settings().folders) add(f);
    for (const t of Object.values(lib())) add(t.folder);
    return [...out].sort((a, b) => a.localeCompare(b));
}

function registerFolder(path) {
    const s = settings();
    path = normFolder(path);
    if (path && !s.folders.includes(path)) s.folders.push(path);
}

/** Rename / move a folder (and everything under it). */
function renameFolder(from, to) {
    const s = settings();
    const re = (p) => (p === from ? to : p.startsWith(`${from}/`) ? normFolder(`${to}/${p.slice(from.length + 1)}`) : p);
    for (const t of Object.values(lib())) if (t.folder) t.folder = re(t.folder);
    s.folders = [...new Set(s.folders.map(re).filter(Boolean))];
    s.folderCollapsed = [...new Set(s.folderCollapsed.map(re).filter(Boolean))];
}

/** Remove a folder level: its NPCs and subfolders move up to the parent. Nothing is deleted. */
function dissolveFolder(path) {
    const s = settings();
    const parent = folderParent(path);
    const re = (p) => (p === path ? parent : p.startsWith(`${path}/`) ? normFolder(`${parent}/${p.slice(path.length + 1)}`) : p);
    for (const t of Object.values(lib())) if (t.folder) t.folder = re(t.folder);
    s.folders = [...new Set(s.folders.filter(f => f !== path).map(re).filter(Boolean))];
    s.folderCollapsed = s.folderCollapsed.filter(f => !inFolder(f, path));
}

function moveNpcToFolder(id, path) {
    const t = lib()[id];
    if (!t) return;
    t.folder = normFolder(path);
    registerFolder(t.folder);
    save();
    renderLibraryList();
    if (libSelected === id) $('#npcb_library .npcb-ed-folder').val(t.folder);
}

async function askFolderName(title, value = '') {
    const c = ctx();
    const res = await c.callGenericPopup(title, c.POPUP_TYPE.INPUT, value, { okButton: 'OK', cancelButton: 'Cancel' });
    if (res === null || res === false || res === undefined) return null;
    return normFolder(res);
}

function openMenu(anchor, items) {
    closePopovers();
    const pop = $(`<div class="npcb-popover npcb-menu">${items.map((x, i) => `<div class="npcb-menu-item ${x.danger ? 'npcb-menu-danger' : ''}" data-i="${i}"><i class="fa-solid ${x.icon}"></i> ${esc(x.label)}</div>`).join('')}</div>`);
    pop.on('click', e => e.stopPropagation());
    pop.on('click', '.npcb-menu-item', (e) => { const x = items[Number($(e.currentTarget).data('i'))]; closePopovers(); x?.run(); });
    placePopover(pop, anchor);
}

function openFolderMenu(anchor, path) {
    const s = settings();
    const npcs = () => Object.values(lib()).filter(t => inFolder(normFolder(t.folder), path));
    openMenu(anchor, [
        { icon: 'fa-user-plus', label: 'New NPC here', run: () => { libNewFolder = path; selectTemplate(null, true); } },
        { icon: 'fa-folder-plus', label: 'New subfolder…', run: async () => {
            const name = await askFolderName(`New folder inside <b>${esc(path)}</b>:`);
            if (!name) return;
            registerFolder(`${path}/${name}`);
            s.folderCollapsed = s.folderCollapsed.filter(f => f !== path);
            save(); renderLibraryList();
        } },
        { icon: 'fa-pen', label: 'Rename / move…', run: async () => {
            const to = await askFolderName('Folder path (use / for subfolders):', path);
            if (!to || to === path) return;
            if (inFolder(to, path)) { toastr.warning('A folder cannot be moved into itself.', 'NPC Book'); return; }
            renameFolder(path, to);
            save(); renderLibraryList();
            if (libSelected && lib()[libSelected]) $('#npcb_library .npcb-ed-folder').val(lib()[libSelected].folder || '');
        } },
        { icon: 'fa-file-export', label: `Export folder (${npcs().length})`, run: () => exportNpcs(npcs(), `${slugify(path)}.npcbook.json`) },
        { icon: 'fa-folder-minus', label: 'Remove folder (keeps NPCs)', danger: true, run: async () => {
            const c = ctx();
            const parent = folderParent(path);
            const ok = await c.callGenericPopup(`Remove the folder <b>${esc(path)}</b>? Its ${npcs().length} NPC(s) and subfolders move to <b>${esc(parent || 'the top level')}</b>. No NPCs are deleted.`, c.POPUP_TYPE.CONFIRM);
            if (!ok) return;
            dissolveFolder(path);
            save(); renderLibraryList();
            if (libSelected && lib()[libSelected]) $('#npcb_library .npcb-ed-folder').val(lib()[libSelected].folder || '');
        } },
    ]);
}

function libItemHtml(t, present, depth, showPath) {
    return `<div class="npcb-lib-item ${t.id === libSelected && !libIsNew ? 'active' : ''}" data-id="${esc(t.id)}" draggable="true" style="padding-left:${6 + depth * 14}px">
          ${avatarHtml(t, t.name, 'npcb-ava-sm')}
          <div class="npcb-lib-item-text"><div>${esc(t.name)} ${present.has(t.id) ? '<i class="fa-solid fa-circle npcb-present-dot" title="In this scene"></i>' : ''}${t.auto ? ' <small class="npcb-badge">auto</small>' : ''}</div>
          <small class="npcb-dim">${esc(showPath && t.folder ? `${t.folder} · ${t.id}` : t.id)}</small></div>
        </div>`;
}

function renderLibraryList() {
    const modal = $('#npcb_library');
    if (!modal.length) return;
    const s = settings();
    const q = normalize(modal.find('.npcb-lib-search').val());
    const present = new Set(hasChat() ? currentRoster().map(i => i.id) : []);
    const byName = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    const all = Object.values(lib());
    const list = modal.find('.npcb-lib-list');
    if (q) {
        const hits = all.filter(t => normalize(`${t.name} ${t.id} ${t.description} ${t.folder || ''}`).includes(q)).sort(byName);
        list.html(hits.length ? hits.map(t => libItemHtml(t, present, 0, true)).join('') : '<div class="npcb-empty">No matching NPCs.</div>');
        return;
    }
    if (!all.length && !s.folders.length) { list.html('<div class="npcb-empty">No NPCs yet.</div>'); return; }
    const folders = allFolders();
    const collapsed = new Set(s.folderCollapsed);
    const npcsIn = (path) => all.filter(t => normFolder(t.folder) === path).sort(byName);
    const countIn = (path) => all.filter(t => inFolder(normFolder(t.folder), path)).length;
    const draw = (parent, depth) => {
        let html = '';
        for (const f of folders.filter(x => folderParent(x) === parent)) {
            const open = !collapsed.has(f);
            html += `<div class="npcb-lib-folder" data-path="${esc(f)}" style="padding-left:${4 + depth * 14}px">
                <i class="fa-solid fa-chevron-${open ? 'down' : 'right'} npcb-lib-fchev"></i><i class="fa-solid fa-folder${open ? '-open' : ''}"></i>
                <span class="npcb-lib-fname">${esc(f.split('/').pop())}</span><small class="npcb-dim">${countIn(f)}</small>
                <i class="fa-solid fa-ellipsis npcb-lib-fmenu" title="Folder actions"></i></div>`;
            if (open) html += draw(f, depth + 1);
        }
        return html + npcsIn(parent).map(t => libItemHtml(t, present, depth, false)).join('');
    };
    list.html(draw('', 0));
}

/** Dialogue example list editor. Mutates the array in place: [{ kind: 'always' | 'mood' | 'situation', value, text }]. */
function mountDialogueExamples(host, list) {
    const states = () => settings().states;
    const draw = () => {
        host.html(`${list.map((d, i) => {
            const kind = d.kind || 'always';
            const moods = [...states()];
            if (kind === 'mood' && d.value && !moods.some(x => normalize(x) === normalize(d.value))) moods.unshift(d.value);
            return `<div class="npcb-dx" data-i="${i}">
                <div class="npcb-row">
                    <select class="text_pole npcb-dx-kind">
                        <option value="always" ${kind === 'always' ? 'selected' : ''}>Always</option>
                        <option value="mood" ${kind === 'mood' ? 'selected' : ''}>When mood is…</option>
                        <option value="situation" ${kind === 'situation' ? 'selected' : ''}>Situation…</option>
                    </select>
                    ${kind === 'mood' ? `<select class="text_pole npcb-dx-value">${moods.map(m => `<option value="${esc(m)}" ${normalize(m) === normalize(d.value) ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>` : ''}
                    ${kind === 'situation' ? `<input class="text_pole npcb-dx-value" value="${esc(d.value || '')}" placeholder="e.g. talking to nobles, in combat">` : ''}
                    <span class="npcb-spacer"></span>
                    <div class="menu_button npcb-dx-del" title="Delete example"><i class="fa-solid fa-trash-can"></i></div>
                </div>
                <textarea class="text_pole npcb-dx-text" rows="2" placeholder='e.g. "You speak as though you have a choice." *He leans forward.*'>${esc(d.text || '')}</textarea>
            </div>`;
        }).join('')}
        <div class="menu_button npcb-dx-add"><i class="fa-solid fa-plus"></i> Add example</div>`);
    };
    const at = (el) => list[Number($(el).closest('.npcb-dx').data('i'))];
    host.off('.dx');
    host.on('click.dx', '.npcb-dx-add', () => { list.push({ kind: 'always', value: '', text: '' }); draw(); host.find('.npcb-dx-text').last().trigger('focus'); });
    host.on('click.dx', '.npcb-dx-del', (e) => { list.splice(Number($(e.target).closest('.npcb-dx').data('i')), 1); draw(); });
    host.on('change.dx', '.npcb-dx-kind', (e) => {
        const d = at(e.target);
        if (!d) return;
        d.kind = String(e.target.value);
        d.value = d.kind === 'mood' ? (states()[0] ?? '') : '';
        draw();
    });
    host.on('input.dx change.dx', '.npcb-dx-value', (e) => { const d = at(e.target); if (d) d.value = String(e.target.value); });
    host.on('input.dx', '.npcb-dx-text', (e) => { const d = at(e.target); if (d) d.text = String(e.target.value); });
    draw();
}

function selectTemplate(id, isNew = false, tab = 'card') {
    if (tab === 'outfit') tab = 'wardrobe';
    resetAssistFor(isNew ? '__new__' : id);
    libIsNew = isNew;
    libSelected = isNew ? null : id;
    libDraftPortrait = null;
    libDraftWardrobe = null;
    renderLibraryList();
    const ed = $('#npcb_library .npcb-lib-editor');
    const t = isNew ? { id: '', name: '', portrait: '', description: '', details: '', traits: {}, color: pickColor(), folder: libNewFolder } : lib()[id];
    if (!t) { ed.html('<div class="npcb-empty">Select or create an NPC.</div>'); return; }
    const s = settings();
    const traitKeys = [...new Set([...s.traitKeys, ...Object.keys(t.traits || {})])];
    const present = hasChat() && !isNew && currentRoster().some(i => i.id === t.id);
    libDraftWardrobe = clone({ wardrobe: t.wardrobe || [], defaultWorn: t.defaultWorn || [] });
    libDraftExt = clone(t.ext || {});
    libDraftDialogue = clone(t.dialogue || []);
    const extTabs = [...extensions.values()].filter(x => x.cardTab);
    ed.html(`
      <div class="npcb-tabs"><div class="npcb-tab ${tab === 'card' ? 'active' : ''}" data-tab="card">Card</div><div class="npcb-tab ${tab === 'wardrobe' ? 'active' : ''}" data-tab="wardrobe">Wardrobe (${(t.wardrobe || []).length})</div>${extTabs.map(x => `<div class="npcb-tab ${tab === `ext:${x.id}` ? 'active' : ''}" data-tab="ext:${esc(x.id)}">${esc(x.cardTab.label || x.id)}</div>`).join('')}</div>
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
      <div class="npcb-tabpane" data-pane="wardrobe" ${tab === 'wardrobe' ? '' : 'style="display:none"'}>
        <div class="npcb-wd-host"></div>
      </div>
      ${extTabs.map(x => `<div class="npcb-tabpane" data-pane="ext:${esc(x.id)}" ${tab === `ext:${x.id}` ? '' : 'style="display:none"'}><div class="npcb-ext-host" data-ext="${esc(x.id)}"></div></div>`).join('')}
      <div class="npcb-row npcb-ed-actions">
        <div class="menu_button npcb-ed-save"><i class="fa-solid fa-floppy-disk"></i> Save</div>
        ${isNew ? '' : `<div class="menu_button npcb-ed-scene">${present ? '<i class="fa-solid fa-user-minus"></i> Remove from scene' : '<i class="fa-solid fa-user-plus"></i> Add to scene'}</div>`}
        ${isNew ? '' : '<div class="menu_button npcb-ed-dup"><i class="fa-solid fa-clone"></i> Duplicate</div>'}
        ${isNew ? '' : '<div class="menu_button npcb-ed-export" title="Export this NPC (saved version) as JSON"><i class="fa-solid fa-file-export"></i> Export</div>'}
        <div class="menu_button npcb-ed-assist" title="LLM assist for the card or wardrobe"><i class="fa-solid fa-wand-magic-sparkles"></i> Assist</div>
        <span class="npcb-spacer"></span>
        ${isNew ? '' : '<div class="menu_button redWarningBG npcb-ed-del"><i class="fa-solid fa-trash"></i> Delete</div>'}
      </div>`);

    ed.off('.npcb');
    bindTabs(ed);
    mountDialogueExamples(ed.find('.npcb-dx-host'), libDraftDialogue);
    ed.on('click.npcb', '.npcb-tab', () => renderAssist());
    ed.on('click.npcb', '.npcb-ed-export', () => exportNpcs([lib()[t.id]].filter(Boolean), `${t.id}.npcbook.json`));
    libWardrobeUi = mountWardrobe(ed.find('.npcb-wd-host'), libDraftWardrobe, {
        key: isNew ? '' : t.id,
        onChange: (d) => ed.find('.npcb-tab[data-tab="wardrobe"]').text(`Wardrobe (${d.wardrobe.length})`),
    });
    const showDraft = () => {
        const cur = libDraftPortrait === null ? (lib()[t.id]?.portrait || '') : libDraftPortrait;
        ed.find('.npcb-ed-portrait').html(cur ? `<img class="npcb-ava npcb-ava-lg" src="${esc(cur)}">` : avatarHtml(null, ed.find('.npcb-ed-name').val() || '?', 'npcb-ava-lg'));
    };
    const usePicked = async (url) => {
        if (!url) return;
        const cropped = await cropImageUrl(url, true);
        libDraftPortrait = cropped || url;
        showDraft();
    };
    ed.on('click.npcb', '.npcb-ed-portrait, .npcb-ed-setimg', (e) => {
        e.stopPropagation();
        openPortraitMenu(e.currentTarget, {
            local: () => ed.find('.npcb-ed-file').trigger('click'),
            server: async () => usePicked(await openServerImagePicker()),
            crop: async () => {
                const cur = libDraftPortrait === null ? (lib()[t.id]?.portrait || '') : libDraftPortrait;
                if (!cur) { toastr.info('No portrait to crop yet.', 'NPC Book'); return; }
                const cropped = await cropImageUrl(cur, false);
                if (cropped) { libDraftPortrait = cropped; showDraft(); }
            },
            generate: isNew ? null : () => { toastr.info(`Generating a portrait for ${t.name}…`, 'NPC Book'); ensurePortrait(t.id, { force: true }); },
            remove: () => { libDraftPortrait = ''; showDraft(); },
        });
    });
    ed.on('click.npcb', '.npcb-ed-cropimg', async () => {
        const cur = libDraftPortrait === null ? (lib()[t.id]?.portrait || '') : libDraftPortrait;
        if (!cur) { toastr.info('No portrait to crop yet.', 'NPC Book'); return; }
        const cropped = await cropImageUrl(cur, false);
        if (cropped) { libDraftPortrait = cropped; showDraft(); }
    });
    ed.on('change.npcb', '.npcb-ed-file', async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try { await usePicked(await readFileAsDataUrl(file)); } catch (err) { toastr.error('Could not read image.', 'NPC Book'); }
    });
    for (const x of extTabs) {
        const host = ed.find(`.npcb-ext-host[data-ext="${x.id}"]`);
        if (!libDraftExt[x.id]) libDraftExt[x.id] = typeof x.defaultData === 'function' ? x.defaultData() : {};
        try { x.cardTab.render(host, { data: libDraftExt[x.id], template: t, isNew, kind: 'char' }); } catch (e) { console.error(`[NPC Book] ${x.id} card tab failed`, e); host.text(`Error: ${e.message}`); }
    }
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
        const ok = await c.callGenericPopup(`Delete NPC <b>${esc(t.name)}</b> (${esc(t.id)})? Scenes that contain it keep their entry but lose its details.`, c.POPUP_TYPE.CONFIRM);
        if (!ok) return;
        delete lib()[t.id];
        save();
        libSelected = null;
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
    if (libDraftPortrait === '') portrait = '';
    else if (libDraftPortrait && !String(libDraftPortrait).startsWith('data:')) portrait = libDraftPortrait;
    else if (libDraftPortrait) {
        try { portrait = await uploadPortrait(libDraftPortrait, id); } catch (e) { console.warn('[NPC Book] upload failed, storing inline', e); portrait = libDraftPortrait; }
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
        wardrobe: (libDraftWardrobe?.wardrobe ?? t.wardrobe ?? []).filter(i => i.name.trim()),
        dialogue: libDraftDialogue.filter(d => String(d.text ?? '').trim()).map(d => ({ kind: d.kind || 'always', value: String(d.value ?? '').trim(), text: String(d.text).trim() })),
        ext: clone(libDraftExt || t.ext || {}),
        defaultWorn: (libDraftWardrobe?.defaultWorn ?? t.defaultWorn ?? []),
        auto: isNew ? false : !!t.auto,
        created: t.created || Date.now(),
        updated: Date.now(),
    };
    registerFolder(lib()[id].folder);
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

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onerror = reject;
        r.onload = () => resolve(String(r.result));
        r.readAsDataURL(file);
    });
}

/** Downscale any image URL to max px (longest side) as webp data URL. */
function downscaleUrl(url, max = 512) {
    return new Promise((resolve, reject) => {
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
        img.src = url;
    });
}

/**
 * Square crop using SillyTavern's built-in cropper (works with mouse and touch).
 * offerFull: cancel means "use the full image" (returns null) instead of "abort".
 */
async function cropImageUrl(url, offerFull) {
    const c = ctx();
    const result = await c.callGenericPopup(offerFull ? 'Crop the portrait, or keep the full image.' : 'Crop the portrait.', c.POPUP_TYPE.CROP, '', {
        cropImage: url, cropAspect: 1, okButton: 'Crop', cancelButton: offerFull ? 'Use full image' : 'Cancel',
    });
    if (!result) return null;
    try { return await downscaleUrl(String(result), 512); } catch { return String(result); }
}

function openPortraitMenu(anchor, actions) {
    closePopovers();
    const items = [
        ['local', 'fa-upload', 'From this device'],
        ['server', 'fa-server', 'From the server (ST images)'],
        ['crop', 'fa-crop-simple', 'Crop current'],
        ['generate', 'fa-wand-magic-sparkles', 'Generate'],
        ['remove', 'fa-trash-can', 'Remove'],
    ].filter(([k]) => actions[k]);
    const pop = $(`<div class="npcb-popover npcb-menu">${items.map(([k, icon, label]) => `<div class="npcb-menu-item" data-act="${k}"><i class="fa-solid ${icon}"></i> ${label}</div>`).join('')}</div>`);
    pop.on('click', e => e.stopPropagation());
    pop.on('click', '.npcb-menu-item', (e) => { const k = $(e.currentTarget).data('act'); closePopovers(); actions[k]?.(); });
    placePopover(pop, anchor);
}

/** Browse images stored on the SillyTavern server: gallery folders, character avatars, persona avatars. */
async function openServerImagePicker() {
    const c = ctx();
    const headers = c.getRequestHeaders();
    let folders = [];
    try { folders = await (await fetch('/api/images/folders', { method: 'POST', headers, body: '{}' })).json(); } catch { folders = []; }
    const sources = [
        { key: '__chars', label: 'Character avatars' },
        { key: '__personas', label: 'Persona avatars' },
        ...folders.sort((a, b) => a.localeCompare(b)).map(f => ({ key: f, label: `Gallery: ${f}` })),
    ];
    const box = $(`<div class="npcb-srv">
        <div class="npcb-row"><select class="text_pole npcb-srv-src">${sources.map(x => `<option value="${esc(x.key)}">${esc(x.label)}</option>`).join('')}</select>
        <input type="search" class="text_pole npcb-srv-filter" placeholder="Filter…"></div>
        <div class="npcb-srv-grid"></div></div>`);
    let chosen = null;
    let items = [];
    const popup = new c.Popup(box, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: false, cancelButton: 'Cancel' });
    const drawGrid = () => {
        const q = normalize(box.find('.npcb-srv-filter').val());
        const list = items.filter(x => !q || normalize(x.label).includes(q)).slice(0, 400);
        box.find('.npcb-srv-grid').html(list.length ? list.map(x => `<div class="npcb-srv-item" data-url="${esc(x.url)}" title="${esc(x.label)}"><img loading="lazy" src="${esc(x.thumb || x.url)}"><span>${esc(x.label)}</span></div>`).join('') : '<div class="npcb-empty">No images here.</div>');
    };
    const load = async (key) => {
        box.find('.npcb-srv-grid').html('<div class="npcb-empty">Loading…</div>');
        if (key === '__chars') {
            items = (c.characters || []).filter(ch => ch?.avatar).map(ch => ({ label: ch.name, url: `/characters/${encodeURIComponent(ch.avatar)}`, thumb: c.getThumbnailUrl('avatar', ch.avatar) }));
        } else if (key === '__personas') {
            const ps = c.powerUserSettings?.personas || {};
            items = Object.entries(ps).map(([file, name]) => ({ label: String(name || file), url: getUserAvatar(file), thumb: c.getThumbnailUrl('persona', file) }));
        } else {
            let files = [];
            try { files = await (await fetch('/api/images/list', { method: 'POST', headers, body: JSON.stringify({ folder: key, sortField: 'date', sortOrder: 'desc' }) })).json(); } catch { files = []; }
            items = (Array.isArray(files) ? files : []).map(f => ({ label: f, url: `/user/images/${encodeURIComponent(key)}/${encodeURIComponent(f)}` }));
        }
        drawGrid();
    };
    box.on('change', '.npcb-srv-src', (e) => load(String(e.target.value)));
    box.on('input', '.npcb-srv-filter', drawGrid);
    box.on('click', '.npcb-srv-item', (e) => { chosen = $(e.currentTarget).data('url'); popup.complete(c.POPUP_RESULT.AFFIRMATIVE); });
    load(sources[0].key);
    await popup.show();
    return chosen;
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

/** A card ready to share: no local bookkeeping, portrait embedded so it works on another SillyTavern. */
async function portableNpc(t) {
    const out = clone(t);
    delete out.auto;
    delete out.created;
    delete out.updated;
    if (out.portrait && !String(out.portrait).startsWith('data:')) {
        try { out.portrait = await downscaleUrl(out.portrait, 512); } catch (e) { console.warn(`[NPC Book] could not embed portrait of ${t.id}`, e); }
    }
    return out;
}

async function exportNpcs(list, filename) {
    if (!list.length) return;
    const npcs = [];
    for (const t of list) npcs.push(await portableNpc(t));
    const blob = new Blob([JSON.stringify({ npcbook: 1, npcs }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportLibrary() {
    return exportNpcs(Object.values(lib()), `npc-book-${new Date().toISOString().slice(0, 10)}.json`);
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
            const npc = { portrait: '', description: '', details: '', traits: {}, height: '', pronouns: '', sexuality: '', sexualExperience: '', wardrobe: [], defaultWorn: [], dialogue: [], ...raw, id, created: Date.now() };
            if (String(npc.portrait).startsWith('data:')) {
                try { npc.portrait = await uploadPortrait(npc.portrait, id); } catch (err) { console.warn('[NPC Book] portrait upload failed, keeping it inline', err); }
            }
            npc.folder = normFolder(npc.folder);
            registerFolder(npc.folder);
            lib()[id] = npc;
            added++;
        }
        save();
        renderLibraryList();
        renderRoster();
        toastr.success(`Imported ${added} NPC(s)${renamed ? `, ${renamed} got a new ID because theirs was taken` : ''}.`, 'NPC Book');
    } catch (err) {
        toastr.error('Invalid JSON file.', 'NPC Book');
    }
}

// ───────────────────────── LLM assist (library side panel) ─────────────────────────

const ASSIST_FIELDS = [
    { key: 'name', label: 'Name', sel: '.npcb-ed-name', hint: 'the character\'s name' },
    { key: 'description', label: 'Description', sel: '.npcb-ed-desc', hint: 'one line, for the user\'s own reference' },
    { key: 'details', label: 'Details', sel: '.npcb-ed-details', hint: 'full profile in prose: appearance, personality, background, manner of speech' },
    { key: 'identity', label: 'Identity', sel: '.npcb-ed-trait', hint: 'object with the identity keys below' },
    { key: 'height', label: 'Height', sel: '.npcb-ed-height', hint: 'e.g. 170 cm' },
    { key: 'pronouns', label: 'Pronouns', sel: '.npcb-ed-pronouns', hint: 'e.g. she/her' },
    { key: 'sexuality', label: 'Sexuality', sel: '.npcb-ed-sexuality', hint: 'e.g. heterosexual, bisexual, gay, asexual' },
    { key: 'sexual_experience', label: 'Sexual exp.', sel: '.npcb-ed-sexexp', hint: 'e.g. virgin, experienced' },
    { key: 'color', label: 'Color', sel: '.npcb-ed-colorhex', hint: 'dialogue color #RRGGBB that suits the character' },
];
const ASSIST_TEXTAREA = new Set(['description', 'details']);

const assist = {
    open: false, busy: false, owner: null, run: null,
    card: { fields: null, useCard: true, useChat: false, prompt: '', result: null, accept: new Set() },
    wardrobe: { count: 8, mode: 'add', cover: true, start: false, prompt: '', result: null },
};

const libEd = () => $('#npcb_library .npcb-lib-editor');
const editorTab = () => String(libEd().find('.npcb-tab.active').data('tab') || 'card');

/** Current (unsaved) values in the card editor. */
function readCardEditor() {
    const ed = libEd();
    const v = (sel) => String(ed.find(sel).val() ?? '').trim();
    const identity = {};
    ed.find('.npcb-ed-trait').each((_, el) => { identity[$(el).data('key')] = String($(el).val() ?? '').trim(); });
    return {
        name: v('.npcb-ed-name'), description: v('.npcb-ed-desc'), details: v('.npcb-ed-details'), identity,
        height: v('.npcb-ed-height'), pronouns: v('.npcb-ed-pronouns'), sexuality: v('.npcb-ed-sexuality'),
        sexual_experience: v('.npcb-ed-sexexp'), color: v('.npcb-ed-colorhex'),
    };
}

const isEmptyValue = (v) => (v && typeof v === 'object' ? Object.values(v).some(x => !String(x ?? '').trim()) : !String(v ?? '').trim());
const valueText = (v) => (v && typeof v === 'object' ? Object.entries(v).filter(([, x]) => String(x ?? '').trim()).map(([k, x]) => `${k}: ${x}`).join(' · ') : String(v ?? ''));

function assistJson(text) {
    const t = String(text ?? '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
    return parseLenientJson(t);
}

function resetAssistFor(owner) {
    if (assist.owner === owner) return;
    assist.owner = owner;
    assist.card.fields = null;
    assist.card.result = null;
    assist.wardrobe.result = null;
}

function markAssistTargets() {
    const ed = libEd();
    ed.find('.npcb-assist-target').removeClass('npcb-assist-target');
    if (!assist.open || editorTab() !== 'card' || !assist.card.fields) return;
    for (const f of ASSIST_FIELDS) if (assist.card.fields.has(f.key)) ed.find(f.sel).addClass('npcb-assist-target');
}

function renderAssist() {
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
    const owned = new Set((libDraftWardrobe?.wardrobe || []).map(i => normalize(i.name)));
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

function cardContextLines(cur) {
    const out = [];
    const id = Object.entries(cur.identity).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('; ');
    if (cur.name) out.push(`Name: ${cur.name}`);
    if (id) out.push(`Identity: ${id}`);
    for (const [k, label] of [['height', 'Height'], ['pronouns', 'Pronouns'], ['sexuality', 'Sexuality'], ['sexual_experience', 'Sexual experience'], ['description', 'Description'], ['details', 'Details']]) {
        if (cur[k]) out.push(`${label}: ${cur[k]}`);
    }
    return out;
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

function buildCardAssist(refine) {
    const s = settings();
    const c = assist.card;
    const fields = ASSIST_FIELDS.filter(f => c.fields.has(f.key));
    if (!fields.length) throw new Error('pick at least one field');
    const keys = s.traitKeys.length ? s.traitKeys : ['race', 'age', 'gender', 'role'];
    const shape = {};
    for (const f of fields) shape[f.key] = f.key === 'identity' ? Object.fromEntries(keys.map(k => [k, '...'])) : '...';
    const lines = [];
    if (c.useCard) {
        const ctxLines = cardContextLines(readCardEditor());
        if (ctxLines.length) lines.push('CURRENT CARD', ...ctxLines, '');
    }
    if (c.useChat) lines.push('RECENT CHAT', recentStory(6, 4000) || '(none)', '');
    if (refine) lines.push('YOUR PREVIOUS ANSWER', JSON.stringify(c.result), '', 'CHANGE REQUEST', c.prompt.trim());
    else lines.push('REQUEST', c.prompt.trim() || '(no extra wishes: make it fit the card)');
    lines.push('', 'Write these fields:', ...fields.map(f => `- ${f.key}: ${f.hint}${f.key === 'identity' ? ` (${keys.join(', ')})` : ''}`));
    lines.push('', 'Answer with exactly this JSON shape:', JSON.stringify(shape, null, 2));
    return { systemPrompt: s.assistCardPrompt, prompt: lines.join('\n') };
}

function readCardAnswer(json) {
    const c = assist.card;
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('the answer was not a JSON object');
    const pick = (...ks) => { for (const k of ks) if (json[k] !== undefined && json[k] !== null && String(json[k]).trim() !== '') return json[k]; return undefined; };
    const res = {};
    for (const f of ASSIST_FIELDS) {
        if (!c.fields.has(f.key)) continue;
        if (f.key === 'identity') {
            const src = json.identity && typeof json.identity === 'object' ? json.identity : json.traits && typeof json.traits === 'object' ? json.traits : null;
            if (!src) continue;
            const keys = [...new Set([...settings().traitKeys, ...Object.keys(readCardEditor().identity)])];
            const id = {};
            for (const k of keys) { const hit = Object.entries(src).find(([sk]) => normalize(sk) === normalize(k)); if (hit && String(hit[1] ?? '').trim()) id[k] = String(hit[1]).trim(); }
            if (Object.keys(id).length) res.identity = id;
            continue;
        }
        let v = f.key === 'sexual_experience' ? pick('sexual_experience', 'sexualExperience') : pick(f.key);
        if (v === undefined) continue;
        v = String(v).trim();
        if (f.key === 'color') { v = normColor(v); if (!v) continue; }
        res[f.key] = v;
    }
    if (!Object.keys(res).length) throw new Error('the answer did not contain any of the requested fields');
    c.result = res;
    c.accept = new Set(Object.keys(res));
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

function buildWardrobeAssist(refine) {
    const s = settings();
    const w = assist.wardrobe;
    const cur = readCardEditor();
    const existing = (libDraftWardrobe?.wardrobe || []).map(i => `${i.name} [${i.slots.join(', ')}]`);
    const lines = ['CHARACTER', ...(cardContextLines(cur).length ? cardContextLines(cur) : ['(no details yet)']), ''];
    if (w.mode === 'add' && existing.length) lines.push('ALREADY IN THE WARDROBE (do not repeat these)', existing.join('; '), '');
    if (refine) lines.push('YOUR PREVIOUS ANSWER', JSON.stringify({ items: w.result.items.map(({ name, slots, note }) => ({ name, slots, note })) }), '', 'CHANGE REQUEST', w.prompt.trim());
    else lines.push('REQUEST', w.prompt.trim() || '(no extra wishes: a practical, fitting everyday wardrobe)');
    lines.push('', `Suggest about ${Math.max(1, Number(w.count) || 8)} items.`);
    if (w.cover) lines.push('Make sure the set includes underwear (upper_inner, lower_inner), something to sleep in, and footwear.');
    if (w.start) lines.push('Also list, in "starting", the item names this character wears right now (one per slot at most).');
    const shape = { items: [{ name: 'Green wool dress', slots: ['upper_outer', 'lower_outer'], note: 'optional, short' }] };
    if (w.start) shape.starting = ['Green wool dress'];
    lines.push(`Valid slots: ${SLOTS.map(x => x.key).join(', ')}.`, '', 'Answer with exactly this JSON shape:', JSON.stringify(shape, null, 2));
    return { systemPrompt: s.assistWardrobePrompt, prompt: lines.join('\n') };
}

function readWardrobeAnswer(json) {
    const w = assist.wardrobe;
    const raw = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : null;
    if (!raw) throw new Error('the answer had no "items" list');
    const owned = new Set((libDraftWardrobe?.wardrobe || []).map(i => normalize(i.name)));
    const items = [];
    for (const r of raw) {
        const name = String(typeof r === 'string' ? r : r?.name ?? '').trim();
        if (!name || items.some(x => normalize(x.name) === normalize(name))) continue;
        const slots = (r?.slots ?? r?.slot) ? normalizeSlots(r.slots ?? r.slot) : inferSlots(name);
        items.push({ name, slots, note: String(r?.note ?? '').trim(), take: !owned.has(normalize(name)) });
    }
    if (!items.length) throw new Error('the answer had no items');
    const starting = new Set();
    for (const ref of Array.isArray(json?.starting) ? json.starting : []) {
        const i = items.findIndex(x => normalize(x.name) === normalize(ref));
        if (i >= 0) starting.add(i);
    }
    w.result = { items, starting };
}

function applyWardrobeAssist() {
    const w = assist.wardrobe;
    const d = libDraftWardrobe;
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
    libWardrobeUi?.refresh();
    libEd().find('.npcb-tab[data-tab="wardrobe"]').text(`Wardrobe (${d.wardrobe.length})`);
    toastr.success(`${w.mode === 'replace' ? 'Wardrobe replaced' : 'Added'}: ${n} item${n === 1 ? '' : 's'}. Press Save to keep them.`, 'NPC Book');
}

function bindAssist(modal) {
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
    bind('#npcb_autofolder', 'autoFolder');
    bind('#npcb_trackchar', 'trackChar', 'checkbox');
    bind('#npcb_trackuser', 'trackUser', 'checkbox');
    bind('#npcb_personainuser', 'personaInUser', 'checkbox');
    bind('#npcb_dialoguecolors', 'dialogueColors', 'checkbox');
    root.find('#npcb_dialoguecolors').on('change', applyCardStyle);
    bind('#npcb_speakerportraits', 'speakerPortraits', 'checkbox');
    bind('#npcb_speakersize', 'speakerPortraitSize', 'number');
    bind('#npcb_autoportraits', 'autoPortraits', 'checkbox');
    bind('#npcb_portraitprompt', 'portraitPrompt');
    bind('#npcb_portraitmode', 'portraitMode');
    bind('#npcb_portraitframing', 'portraitFraming', 'checkbox');
    bind('#npcb_portraitprefix', 'portraitPrefix');
    bind('#npcb_portraitnegative', 'portraitNegative');
    bind('#npcb_portraitllm', 'portraitLlmPrompt');
    root.find('#npcb_reset_portraitllm').on('click', () => { s.portraitLlmPrompt = DEFAULT_PORTRAIT_LLM_PROMPT; root.find('#npcb_portraitllm').val(s.portraitLlmPrompt); save(); });
    root.find('#npcb_speakerportraits, #npcb_speakersize, #npcb_enabled').on('input change', () => { applyCardStyle(); decorateAll(); });
    bind('#npcb_speakerrule', 'speakerRule');
    bind('#npcb_speakerreminder', 'speakerReminder');
    root.find('#npcb_reset_speakerreminder').on('click', () => { s.speakerReminder = DEFAULT_SPEAKER_REMINDER; root.find('#npcb_speakerreminder').val(s.speakerReminder); save(); updateAutoInjection(); });
    root.find('#npcb_reset_speaker').on('click', () => { s.speakerRule = DEFAULT_SPEAKER_RULE; root.find('#npcb_speakerrule').val(s.speakerRule); save(); });
    bind('#npcb_trackoutfits', 'trackOutfits', 'checkbox');
    bind('#npcb_exposure', 'describeExposure', 'checkbox');
    bind('#npcb_incwardrobe', 'includeWardrobe', 'checkbox');
    bind('#npcb_wdgrowth', 'allowWardrobeGrowth', 'checkbox');
    bind('#npcb_outfitrules', 'outfitRules');
    bind('#npcb_assistcard', 'assistCardPrompt');
    bind('#npcb_assistwardrobe', 'assistWardrobePrompt');
    root.find('#npcb_reset_assistcard').on('click', () => { s.assistCardPrompt = DEFAULT_ASSIST_CARD_PROMPT; root.find('#npcb_assistcard').val(s.assistCardPrompt); save(); });
    root.find('#npcb_reset_assistwardrobe').on('click', () => { s.assistWardrobePrompt = DEFAULT_ASSIST_WARDROBE_PROMPT; root.find('#npcb_assistwardrobe').val(s.assistWardrobePrompt); save(); });
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
    registerTurnFormatter();
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
    applyCardStyle();
    decorateAll();
    ensurePersonaButton();
    window.NPCBook = {
        version: 3,
        /**
         * Register a sister extension.
         * def = { id, label?, defaultData?(), cardTab?: { label, render(host, {data, template, isNew, kind}) },
         *         personaSheet?: { label, icon?, render(host, {data, kind, name}) },
         *         sceneXml?({kind, name, id, template, instance, data}) -> string,
         *         instructions?({autoCreate}) -> string, fromTracker?(entry, template) -> data }
         * Card/persona `data` objects are mutable drafts; NPC Book saves them when the user presses Save.
         */
        registerExtension(def) {
            if (!def?.id) throw new Error('registerExtension: id required');
            extensions.set(def.id, def);
            if ($('#npcb_library').is(':visible') && (libSelected || libIsNew)) selectTemplate(libSelected, libIsNew);
            updateAutoInjection();
        },
        getLibrary: () => lib(),
        getTemplate: (id) => lib()[id] || null,
        getPersonaData: (extId) => personaData().ext?.[extId] ?? null,
        /** Who is in the current scene: [{ id, name, template }] plus your persona's name. */
        getScene: () => ({
            roster: hasChat() ? currentRoster().map(i => ({ id: i.id, name: templateFor(i)?.name ?? i.name ?? i.id, template: templateFor(i) })) : [],
            userName: ctx().name1,
        }),
        /** Who was in the scene at a chat message (for the last message: before + after it): [{ id, name, template }]. */
        getRosterAt: (idx) => (hasChat() ? rosterAtMessage(Number(idx)) : []).map(id => ({ id, name: lib()[id]?.name ?? id, template: lib()[id] || null })),
        /** Resolve an id or name (as written by the LLM in <npc id="…">) to a library id, or null. */
        resolveNpc: (ref) => resolveRef(ref, lib()),
        openPersonaCharacter,
        saveSettings: save,
        util: { esc, xa, xt, normalize, slugify, indent },
    };
    document.dispatchEvent(new CustomEvent('npcbook:ready', { detail: window.NPCBook }));
});
