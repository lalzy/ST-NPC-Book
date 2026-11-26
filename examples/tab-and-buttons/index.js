// ─────────────────────────────────────────────────────────────────────────────
// Example 2: tabs and buttons ("Notes")
//
// Builds on example 1. One field again (a free-text note per character), but
// now it shows up in every place NPC Book lets you add UI:
//   1. cardTab      a tab on the NPC card in the library        (as in example 1)
//   2. chatTab      the same tab in the chat's scene-bar popover (click an NPC)
//   3. sceneButton  an icon in the scene bar's top row
//   4. modalButton  a button in the NPC Book window header
// ─────────────────────────────────────────────────────────────────────────────

const EXT_ID = 'ex2_notes';

function register(api) {
    // Small helper: the note stored on a character (card or chat copy), or ''.
    const noteOf = (character) => character?.ext?.[EXT_ID]?.text || '';

    api.registerExtension({
        id: EXT_ID,
        label: 'Notes',
        defaultData: () => ({ text: '' }),

        // ── 1. Tab on the NPC card ───────────────────────────────────────────
        cardTab: {
            label: 'Notes',
            icon: 'fa-note-sticky',
            render(host, { data }) {
                host.html(`<textarea class="text_pole" rows="5" placeholder="Anything you want to remember">${api.util.esc(data.text || '')}</textarea>`);
                host.find('textarea').on('input', (e) => { data.text = e.target.value; });
            },
            // Runs after NPC Book saved the data. We redraw the scene bar so
            // the scene button below can light up / dim right away.
            onSave: () => api.refreshScene(),
        },

        // ── 2. Same tab inside a chat ────────────────────────────────────────
        // `true` = reuse cardTab.render. Clicking an NPC in the scene bar now
        // shows a "Notes" tab next to State and Outfit. Edits there change
        // this chat's copy only, not the library card.
        chatTab: true,

        // ── 3. Icon in the scene bar ─────────────────────────────────────────
        sceneButton: {
            icon: 'fa-note-sticky',
            title: 'Show notes for everyone in the scene',
            // Dimmed when nobody in the scene has a note.
            active: () => api.getScene().roster.some((r) => noteOf(r.instance)),
            onClick() {
                const lines = api.getScene().roster
                    .filter((r) => noteOf(r.instance))
                    .map((r) => `<b>${api.util.esc(r.name)}</b>: ${api.util.esc(noteOf(r.instance))}`);
                toastr.info(lines.join('<br>') || 'Nobody in the scene has a note.', 'Notes', { escapeHtml: false });
            },
        },

        // ── 4. Button in the NPC Book window header ──────────────────────────
        modalButton: {
            icon: 'fa-note-sticky',
            label: 'Notes',
            title: 'How many library cards have notes',
            onClick() {
                const cards = Object.values(api.getLibrary());
                const withNotes = cards.filter((card) => noteOf(card)).length;
                toastr.info(`${withNotes} of ${cards.length} cards have notes.`, 'Notes');
            },
        },

        // And, as in example 1, let the AI see the note.
        sceneXml: ({ data }) => (data?.text ? `<note>${api.util.xt(data.text)}</note>` : ''),
    });
}

if (window.NPCBook) register(window.NPCBook);
else document.addEventListener('npcbook:ready', (e) => register(e.detail), { once: true });

// ─────────────────────────────────────────────────────────────────────────────
// Good to know
// • Remove `chatTab: true` and the chat popover shows a "Notes sheet" button
//   instead of a tab (rename it with `sheetLabel: 'My label'`).
// • `icon`, `title` and `label` on buttons can also be functions, e.g.
//   title: () => `${count()} notes`. Call api.refreshScene() (scene button)
//   or api.refreshModalButtons() (header button) after the value changes.
// • Want the same tab for your persona? Add personaSheet: { label, render }
//   (see examples/simple-stats).
// ─────────────────────────────────────────────────────────────────────────────
