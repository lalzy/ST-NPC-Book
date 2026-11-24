// Adds a <style> block to the page once (for UI modules that ship their own small stylesheet).

export function injectStyle(id, css) {
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = css;
    document.head.appendChild(el);
}
