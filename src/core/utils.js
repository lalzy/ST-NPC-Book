// Pure string / object helpers (escaping, cloning, hashing, indentation).

export function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
}

export function clone(x) { return JSON.parse(JSON.stringify(x ?? null)); }

export function sig(text) {
    let h = 0;
    const str = String(text ?? '');
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return `${str.length}:${h}`;
}

export function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
}

export function xa(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
export function xt(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
export function indent(text, n) { const pad = ' '.repeat(n); return String(text).split('\n').map(l => (l ? pad + l : l)).join('\n'); }
