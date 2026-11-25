// NPC Book — Simple Stats: an example stat-sheet sister extension (HP and a free-form stat list).
// Shows a game-system sheet end to end: editor tabs, live HP changes from the LLM, a scene-bar button that writes data
// through setExtData, and per-chat data that rolls back with swipes. Swap the fields for Ironsworn, D&D or your own system.

const EXT_ID = 'simple_stats';

function register(api) {
    const { esc, xa, xt } = api.util;
    const enabled = { prompt: true }; // a toggle for the scene button

    function renderSheet(host, { data }) {
        const stats = Object.entries(data.stats || {}).map(([k, v]) => `${k}=${v}`).join(', ');
        host.html(`
            <div class="flex-container">
                <label>HP <input type="number" class="text_pole ss-hp" value="${esc(data.hp)}"></label>
                <label>Max HP <input type="number" class="text_pole ss-max" value="${esc(data.maxHp)}"></label>
            </div>
            <label>Stats (name=value, comma separated) <input class="text_pole ss-stats" value="${esc(stats)}" placeholder="str=12, dex=14"></label>
            <label>Notes <textarea class="text_pole ss-notes" rows="3">${esc(data.notes)}</textarea></label>`);
        host.find('.ss-hp').on('input', (e) => { data.hp = Number(e.target.value) || 0; });
        host.find('.ss-max').on('input', (e) => { data.maxHp = Number(e.target.value) || 0; });
        host.find('.ss-notes').on('input', (e) => { data.notes = e.target.value; });
        host.find('.ss-stats').on('input', (e) => {
            data.stats = Object.fromEntries(e.target.value.split(',').map(p => p.split('=').map(x => x.trim())).filter(([k]) => k).map(([k, v]) => [k, Number(v) || 0]));
        });
    }

    const clampHp = (d, hp) => Math.max(0, Math.min(Number(d.maxHp) || 0, Math.round(Number(hp))));

    api.registerExtension({
        id: EXT_ID,
        label: 'Stats',
        defaultData: () => ({ hp: 10, maxHp: 10, stats: {}, notes: '' }),
        cardTab: { label: 'Stats', icon: 'fa-dice-d20', render: renderSheet },
        personaSheet: { label: 'Stats', icon: 'fa-dice-d20', render: renderSheet },
        sheetLabel: 'Stat sheet', // label of the button in the scene-bar character popover

        instructions: () => (enabled.prompt
            ? 'When a character is hurt or healed, add "hp": <new current HP> to their entry. New characters may include "stats": {"hp": 10, "max_hp": 10}.'
            : ''),

        fromTracker: (entry) => {
            const s = entry.stats && typeof entry.stats === 'object' ? entry.stats : null;
            if (!s) return null;
            const maxHp = Number(s.max_hp ?? s.hp) || 10;
            return { hp: Number(s.hp ?? maxHp) || maxHp, maxHp, stats: {}, notes: '' };
        },

        // Live changes: data is this chat's copy (null until first written), so changes roll back on swipe.
        onTrackerEntry: ({ entry, data, kind }) => {
            if (entry.hp === undefined || Number.isNaN(Number(entry.hp))) return undefined;
            const d = data || (kind === 'user' ? api.getPersonaData(EXT_ID) : null) || { hp: 10, maxHp: 10, stats: {}, notes: '' };
            return { ...d, hp: clampHp(d, entry.hp) };
        },
        entryKeys: ['hp'],

        sceneXml: ({ data }) => {
            if (!data || !enabled.prompt) return '';
            const stats = Object.entries(data.stats || {}).map(([k, v]) => ` ${k.replace(/[^\w-]/g, '_')}="${xa(v)}"`).join('');
            return `<stats hp="${xa(data.hp)}/${xa(data.maxHp)}"${stats}>${data.notes ? xt(data.notes) : ''}</stats>`;
        },

        // A scene-bar button: click toggles whether stats are sent to the LLM; shift-click heals everyone in the scene.
        sceneButton: {
            icon: () => 'fa-dice-d20',
            title: () => (enabled.prompt ? 'Stats are sent to the AI (click to stop, shift-click to heal everyone)' : 'Stats are not sent (click to send)'),
            active: () => enabled.prompt,
            onClick: () => {
                if (window.event?.shiftKey) {
                    for (const { id } of api.getScene().roster) {
                        const d = api.getExtData(id, EXT_ID);
                        if (d) api.setExtData(id, EXT_ID, { ...d, hp: d.maxHp });
                    }
                    toastr.info('Everyone in the scene is at full HP.', 'Simple Stats');
                } else {
                    enabled.prompt = !enabled.prompt;
                }
                api.refreshScene();
            },
        },
    });
}

if (window.NPCBook) register(window.NPCBook);
else document.addEventListener('npcbook:ready', (e) => register(e.detail), { once: true });
