// Shared runtime state: registered sister extensions and the generation in progress.

/** Sister extensions registered through window.NPCBook.registerExtension(). */
export const extensions = new Map();

/** Generation in progress: { type, pre, preUser, targetIdx, idx? } (written by tracking, read by the prompt builders). */
export const runtime = { genCtx: null };
