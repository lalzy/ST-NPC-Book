// Image helpers: read files, downscale, crop, upload to the server.

import { ctx } from '../core/context.js';
import { slugify } from '../logic/text.js';

export function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onerror = reject;
        r.onload = () => resolve(String(r.result));
        r.readAsDataURL(file);
    });
}

/** Downscale any image URL to max px (longest side) as webp data URL. */
export function downscaleUrl(url, max = 512) {
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
export async function cropImageUrl(url, offerFull) {
    const c = ctx();
    const result = await c.callGenericPopup(offerFull ? 'Crop the portrait, or keep the full image.' : 'Crop the portrait.', c.POPUP_TYPE.CROP, '', {
        cropImage: url, cropAspect: 1, okButton: 'Crop', cancelButton: offerFull ? 'Use full image' : 'Cancel',
    });
    if (!result) return null;
    try { return await downscaleUrl(String(result), 512); } catch { return String(result); }
}

export async function uploadPortrait(dataUrl, id) {
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
