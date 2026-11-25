// Shared editing state of the NPC Library window.

/** Library window editing state, shared by the list, editor, assist panel and portrait queue. */
export const libState = {
    selected: null,
    isNew: false,
    draftPortrait: null,
    draftOutfit: [],
    dollUi: null,
    newFolder: '',
    draftExt: {},
    draftDialogue: [],
};
