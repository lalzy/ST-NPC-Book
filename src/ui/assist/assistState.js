// LLM assist panel state and readers of the card editor.

export const ASSIST_FIELDS = [
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
export const ASSIST_TEXTAREA = new Set(['description', 'details']);

export const assist = {
    open: false, busy: false, owner: null, run: null,
    card: { fields: null, useCard: true, useChat: false, prompt: '', result: null, accept: new Set() },
};

export const libEd = () => $('#npcb_library .npcb-lib-editor');
export const editorTab = () => String(libEd().find('.npcb-tab.active').data('tab') || 'card');

/** Current (unsaved) values in the card editor. */
export function readCardEditor() {
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

export const isEmptyValue = (v) => (v && typeof v === 'object' ? Object.values(v).some(x => !String(x ?? '').trim()) : !String(v ?? '').trim());
export const valueText = (v) => (v && typeof v === 'object' ? Object.entries(v).filter(([, x]) => String(x ?? '').trim()).map(([k, x]) => `${k}: ${x}`).join(' · ') : String(v ?? ''));

export function resetAssistFor(owner) {
    if (assist.owner === owner) return;
    assist.owner = owner;
    assist.card.fields = null;
    assist.card.result = null;
}
