// Static configuration: module ids, injection keys, default prompt texts, palette and default settings.

import { SLOTS } from './logic/slots.js';

export const MODULE = 'npc_book';
export const EXT_FOLDER = new URL('../', import.meta.url).pathname // extension root (this file is in src/);
export const PM_SCENE_ID = 'npcbook_scene';
export const PM_INSTR_ID = 'npcbook_instructions';
export const INJECT_SCENE_KEY = 'npcbook_scene';
export const INJECT_INSTR_KEY = 'npcbook_instructions';
export const INJECT_REMIND_KEY = 'npcbook_speaker_reminder';

export const DEFAULT_INSTRUCTIONS = `
<npc_tracking_switch state=enabled>
Write your reply as usual. Then, at the very end, add one <npcs> block that records what CHANGED in the scene during your reply. Do not explain or plan the block; just write it.

Put in the block:
- A character already in the scene whose posture, state, feelings or clothing changed in your reply: their "id" and only the fields that changed. Compare with the scene: if a character's mood in your reply no longer matches their listed state (listed Calm, but your reply shows cold anger), that is a change, so give the new state.
- A character who arrived: their "id" from Known NPCs, plus "posture" and "state". Someone not in Known NPCs (or a different person who shares a name) gets "name" and "new": true, plus "traits" with [[TRAIT_KEYS]], the profile fields, and always a "wardrobe" of 4-8 items that fit their role (a guard: armor, uniform, boots) with an "outfit" for what they wear now, as in the example.
- Track characters who matter: anyone with a name, and the first individual who speaks to or deals directly with [[USER]] (the guard who stops them at the gate, the innkeeper, a shopkeeper). Name an unnamed one by role, e.g. "Gate Guard". Guards, patrons and townsfolk who only watch or stand around are background: leave them out. At most [[MAX_NEW]] new characters per reply.
- A character who left: {"id": "...", "left": true}.
- Report only what your reply actually shows. Leave out everyone and everything that did not change.
- Every reply ends with the <npcs> block, even when nothing changed: write <npcs>[]</npcs>. A reply without it is incomplete.
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
    {"name": "Mara", "new": true, "traits": {[[TRAIT_EXAMPLE]]}, "posture": "Standing", "state": "Curious", "feelings": "Who are these people?", "description": "Traveling herbalist.", "details": "Lean, sun-browned, grey-streaked braid. Blunt and practical, distrusts nobles. Grew up in the hill villages; speaks in short sentences.", "height": "168 cm", "pronouns": "she/her", "sexuality": "heterosexual", "sexual_experience": "experienced", "wardrobe": [{"name": "Green wool dress", "slots": ["upper_outer", "lower_outer"]}, {"name": "Linen shift", "slots": ["upper_inner", "lower_inner"]}, {"name": "Leather boots", "slots": ["feet_outer"]}, {"name": "Hooded travel cloak", "slots": ["cover"]}, {"name": "Herb satchel", "slots": ["other"]}], "outfit": {"wear": ["Green wool dress", "Leather boots", "Herb satchel"]}}[[USER_EXAMPLE]]
]
</npcs>

Known NPCs (id: name — identity):
[[LIBRARY]]
</npc_tracking_switch >`;

/** The previous default tracking prompt: saved settings that still hold it exactly are moved to the new default. */
export const DEFAULT_INSTRUCTIONS_V1 = `
<npc_tracking_switch state=enabled>
At the very end of EVERY reply, output one <npcs> block listing every character who is physically present in the scene at the end of your reply, except [[EXCLUDE]].
- Characters who left the scene must be omitted. Characters who arrived must be added.
- If nobody is present, output <npcs>[]</npcs>.
- Reuse the exact "id" of a character already present, or listed under Known NPCs, ONLY if it is the same person (same identity: [[TRAIT_KEYS]]). Someone who merely shares a name is a different, NEW character.
- For a character that is not present and not listed, add "new": true plus "description" (one line), "details" (full profile: appearance, personality, background, manner of speech), "height", "pronouns" and "sexual_experience".
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
[[LIBRARY]]
</npc_tracking_switch>`;

export const DEFAULT_OUTFIT_RULES = `Clothing:
- Characters only wear items from their own wardrobe (listed in the scene). Never invent clothing for someone who has a wardrobe.
- When someone's clothing changes, add "outfit": {"wear": ["item_id"], "remove": ["item_id"], "condition": {"item_id": "<condition>"}} to their entry. Putting an item on replaces whatever is in the same slots.
- Choose clothing that fits the situation, e.g. sleepwear in bed.
- <wearing> is what each character has on right now. Its "exposure" (e.g. completely naked, topless, barefoot) is literal: describe and react to it accordingly.
- "condition" is one of: [[CONDITIONS]]
- A new character also gets "wardrobe": 4-8 fitting items as [{"name": "...", "slots": ["..."]}], and "outfit": {"wear": ["item name", ...]} for what they wear now. Slots: [[SLOTS]]`;

export const DEFAULT_RELATIONSHIP_RULE = `Relationships:
- When your reply changes how a character feels about someone ([[USER]] or another character), or they form a new bond, add "relationships" to that character's entry with only what changed, e.g. {"id": "...", "relationships": {"user": {"type": "Friend", "attitude": "Friendly", "note": "Saved her from the bandit."}}}.
- Use "user" for [[USER]] and the id for anyone else. Give "type" only for a new or changed bond; "note" is one short line.
- "type" is one of: [[REL_TYPES]]
- "attitude" is one of: [[ATTITUDES]]
- Use these exact words. Anything else is ignored.`;

/** The first default relationship type list (no pairs): saved settings that still hold it exactly get the paired default. */
export const DEFAULT_RELATIONSHIP_TYPES_V1 = ['Stranger', 'Acquaintance', 'Friend', 'Close friend', 'Lover', 'Spouse', 'Family', 'Sibling', 'Parent', 'Child', 'Mentor', 'Student', 'Employer', 'Employee', 'Colleague', 'Rival', 'Enemy'];

/** The first relationship rule (free-text types): saved settings that still hold it exactly are moved to the new default. */
export const DEFAULT_RELATIONSHIP_RULE_V1 = `Relationships:
- When your reply changes how a character feels about someone ([[USER]] or another character), or they form a new bond, add "relationships" to that character's entry with only what changed, e.g. {"id": "...", "relationships": {"user": {"attitude": "Friendly", "note": "Saved her from the bandit."}}}.
- Use "user" for [[USER]] and the id for anyone else. Give "type" (friend, sister, rival, employer...) only for a new or changed bond; "note" is one short line.
- "attitude" is one of: [[ATTITUDES]]`;

export const DEFAULT_SPEAKER_RULE = `Speaker blocks (mandatory in every reply):
- Everything a character does or says goes inside <npc id="ID">...</npc>: their actions, the narration about them, and all of their dialogue. Use their exact id from the scene.
- Open a new block every time the focus moves to another character. Only narration that belongs to no character (setting, weather, time passing) may stand outside a block. Never nest blocks.
- Write dialogue in plain double quotes, without HTML or font tags.
- A reply without speaker blocks is wrong. Example of a correct reply (the ids are examples):
The fire crackles in the hearth.
<npc id="ada">Ada sets down the kettle. "You should rest."</npc>
<npc id="bram">Bram folds his arms. "He's fine."</npc>`;

export const DEFAULT_SPEAKER_REMINDER = `[Reminder: put each character's part of this reply inside <npc id="ID">...</npc>. Characters in the scene: [[IDS]]. Only narration that belongs to no one stays outside the blocks.]`;

export const DEFAULT_ASSIST_CARD_PROMPT = `You help write character cards for NPCs in a roleplay.
- Write only the fields you are asked for, in the language of the request.
- Keep every value consistent with the current card unless the request says otherwise.
- Be concrete and specific; avoid clichés and purple prose.
- Answer with one JSON object and nothing else.`;

export const DEFAULT_ASSIST_WARDROBE_PROMPT = `You help build wardrobes for characters in a roleplay.
- Suggest clothing that fits the character (culture, era, job, personality, budget) and the request.
- Give each item a plain, specific name with color or material, e.g. "Green wool dress".
- Each item covers one or more body slots; a dress covers upper_outer and lower_outer, a jumpsuit too.
- Answer with one JSON object and nothing else.`;

export const DEFAULT_PORTRAIT_LLM_PROMPT = `Describe {{name}}'s portrait for an image generator. Use the template below.

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

export const DEFAULT_PORTRAIT_LLM_PROMPT_V1 = `Describe {{name}} for an image generator. Use the template below.

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

export const COLOR_PALETTE = ['#e6a0c4', '#8ecae6', '#f4a261', '#90be6d', '#c77dff', '#ffd166', '#ef476f', '#06d6a0', '#a0c4ff', '#ffadad', '#bdb2ff', '#caffbf', '#f28482', '#84a59d', '#e9c46a', '#9bf6ff'];
export const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Concrete example values for the tracking prompt (smaller models copy "..." literally). */
export const TRAIT_SAMPLES = { race: 'human', species: 'human', age: '41', gender: 'female', sex: 'female', role: 'herbalist', job: 'herbalist', occupation: 'herbalist', class: 'commoner' };

export const DEFAULT_USER_RULE = `- When [[USER]]'s posture or clothing changes, add {"id": "user"} with only what changed ("posture" from the list above, "outfit" with items from [[USER]]'s wardrobe). Never give [[USER]] a state or feelings.`;

export const DEFAULTS = {
    enabled: true,
    debug: false,
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
    trackRelationships: false, // optional: relationships cost context, so they are opt-in
    attitudes: ['Hostile', 'Distrustful', 'Wary', 'Neutral', 'Friendly', 'Warm', 'Close', 'Devoted'],
    // One type per line; "A <> B" pairs two types that are each other's reverse (used by the ⇄ link).
    relationshipTypes: ['Stranger', 'Acquaintance', 'Friend', 'Close friend', 'Lover', 'Spouse', 'Family', 'Sibling', 'Parent <> Child', 'Mentor <> Student', 'Employer <> Employee', 'Colleague', 'Rival', 'Enemy'],
    relationshipRule: DEFAULT_RELATIONSHIP_RULE,
    relViewLayout: 'web', // relationship view: 'web' | 'tree' (remembered)
    relViewDepth: 2, // 1 = direct only, 2 = + their links
    includeWardrobe: true,
    allowWardrobeGrowth: true,
    wardrobeDollCollapsed: false,
    folders: [],
    folderCollapsed: [],
    autoFolder: '',
    maxNewPerReply: 2,
    assistCardPrompt: DEFAULT_ASSIST_CARD_PROMPT,
    assistWardrobePrompt: DEFAULT_ASSIST_WARDROBE_PROMPT,
    outfitRules: DEFAULT_OUTFIT_RULES,
    conditions: ['Worn', 'Loosened', 'Disheveled', 'Wet', 'Dirty', 'Bloody', 'Torn'],
    personas: {},
    library: {},
};

export const SLOT_LABEL = Object.fromEntries(SLOTS.map(x => [x.key, x.label]));
