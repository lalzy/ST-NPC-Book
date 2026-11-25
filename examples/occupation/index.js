// NPC Book — Occupation: a minimal example sister extension that adds one tracked field, "occupation".
// It shows the smallest useful set of hooks: an editor tab, prompt text, reading the LLM's tracker entries
// (new and existing characters), and what the LLM sees in {{npcScene}}. Copy this folder and rename it to start your own.

const EXT_ID = 'occupation'; // also the key in every character's `ext` object: ext.occupation = { title, workplace }

function register(api) {
    const { esc, xa } = api.util;

    // Shared editor for NPC cards, chat instances and the persona. `data` is a draft: NPC Book saves it on Save.
    function renderEditor(host, { data }) {
        host.html(`
            <label>Occupation <input class="text_pole occ-title" value="${esc(data.title)}" placeholder="e.g. baker"></label>
            <label>Workplace <input class="text_pole occ-where" value="${esc(data.workplace)}" placeholder="e.g. the village bakery"></label>`);
        host.find('.occ-title').on('input', (e) => { data.title = e.target.value; });
        host.find('.occ-where').on('input', (e) => { data.workplace = e.target.value; });
    }

    api.registerExtension({
        id: EXT_ID,
        label: 'Occupation',
        defaultData: () => ({ title: '', workplace: '' }),

        // UI: a tab on NPC cards (also used for the chat-only sheet in the scene bar) and on the persona window.
        cardTab: { label: 'Occupation', icon: 'fa-briefcase', render: renderEditor },
        personaSheet: { label: 'Occupation', icon: 'fa-briefcase', render: renderEditor },

        // Prompt: one line added to the tracking rules, and a [[OCCUPATIONS]] placeholder users may put in the prompt.
        instructions: () => 'If a character\'s job is revealed or changes, add "occupation": "job title" to their entry (and to every new character).',
        placeholders: {
            OCCUPATIONS: () => api.getScene().roster.map(r => r.instance.ext?.[EXT_ID]?.title).filter(Boolean).join(', ') || 'none known',
        },

        // A brand-new NPC made from the tracker: build its starting data from the entry.
        fromTracker: (entry) => (entry.occupation ? { title: String(entry.occupation), workplace: '' } : null),

        // Every entry the LLM writes (and every greeting cast entry): update this chat's copy. undefined = no change.
        onTrackerEntry: ({ entry, data }) => {
            if (!entry.occupation) return undefined;
            return { ...(data || { workplace: '' }), title: String(entry.occupation) };
        },
        // Greeting cast blocks may say {"id": "suzie", "occupation": "nurse"}: claim the key so NPC Book does not warn.
        entryKeys: ['occupation'],

        // What the LLM sees inside the character's block in {{npcScene}}. `data` is this character's ext.occupation.
        sceneXml: ({ data }) => (data?.title ? `<occupation title="${xa(data.title)}"${data.workplace ? ` at="${xa(data.workplace)}"` : ''}/>` : ''),
    });
}

// NPC Book may load before or after this extension: handle both.
if (window.NPCBook) register(window.NPCBook);
else document.addEventListener('npcbook:ready', (e) => register(e.detail), { once: true });
