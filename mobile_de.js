// ==UserScript==
// @name         mobile.de - windowed large photo
// @version      2.3
// @description  Opens the clicked ad photo in a large viewer inside the current tab for side-by-side comparison. Navigate with arrow buttons or keyboard keys, wrap between the first and last photo, and close with Escape or ×. Leaves trackpad pinch zoom and two-finger panning to Chrome.
// @match        https://suchen.mobile.de/*
// @match        https://www.mobile.de/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// ==/UserScript==
(() => {
    'use strict';
    let activeClose;
    let clickedPhoto;
    function photoKey(src) {
        try { const u = new URL(src, location.href); return u.hostname + u.pathname; }
        catch { return ''; }
    }
    document.addEventListener('click', e => {
        const target = e.target instanceof Element ? e.target : null;
        let img = target?.closest('img') || target?.closest('button')?.querySelector('img');
        if (!img) {
            img = Array.from(document.images).filter(candidate => {
                const r = candidate.getBoundingClientRect();
                return photoKey(candidate.currentSrc || candidate.src).includes('classistatic.de/')
                    && r.width > 0 && e.clientX >= r.left && e.clientX <= r.right
                    && e.clientY >= r.top && e.clientY <= r.bottom;
            }).sort((a, b) => {
                const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
                return ar.width * ar.height - br.width * br.height;
            })[0];
        }
        if (img && photoKey(img.currentSrc || img.src).includes('classistatic.de/')) {
            clickedPhoto = {key: photoKey(img.currentSrc || img.src), time: Date.now()};
        }
    }, true);
    function openPhotos(root) {
        const gallery = root.querySelector('[data-testid="fullscreen-gallery"]');
        if (!gallery) return;
        const photos = [];
        let selected = 0;
        for (const img of gallery.querySelectorAll('[data-testid="slide"] img')) {
            const url = new URL(img.src, location.href);
            if (!url.hostname.endsWith('classistatic.de')) continue;
            url.searchParams.set('rule', 'mo-1600');
            if (photos.some(p => p.src === url.href)) continue;

            photos.push({src: url.href, alt: img.alt});
        }
        if (!photos.length) return;
        const clickedIndex = clickedPhoto && Date.now() - clickedPhoto.time < 2000
            ? photos.findIndex(p => photoKey(p.src) === clickedPhoto.key) : -1;
        if (clickedIndex >= 0) selected = clickedIndex;
        else {
            // Maximize opens the currently centered carousel image.
            const center = gallery.getBoundingClientRect().left + gallery.clientWidth / 2;
            let nearest = Infinity;
            for (const img of gallery.querySelectorAll('[data-testid="slide"] img')) {
                const r = img.getBoundingClientRect();
                const distance = Math.abs(r.left + r.width / 2 - center);
                const index = photos.findIndex(p => photoKey(p.src) === photoKey(img.src));
                if (r.width && index >= 0 && distance < nearest) { nearest = distance; selected = index; }
            }
        }
        clickedPhoto = undefined;
        activeClose?.();
        const overlay = document.createElement('div');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', 'Large ad photos');
        overlay.tabIndex = -1;
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#111;display:flex;align-items:center;justify-content:center;';
        const image = document.createElement('img');
        image.style.cssText = 'position:static!important;width:100%!important;height:100%!important;object-fit:contain!important;';
        overlay.appendChild(image);
        const counter = document.createElement('span');
        counter.style.cssText = 'position:absolute;bottom:12px;left:50%;transform:translateX(-50%);background:#111c;color:white;padding:6px 12px;border-radius:8px;font:16px sans-serif;';
        overlay.appendChild(counter);
        function show(delta = 0) {
            selected = (selected + delta + photos.length) % photos.length;
            image.src = photos[selected].src;
            image.alt = photos[selected].alt;
            counter.textContent = (selected + 1) + ' / ' + photos.length;
        }
        const previousOverflow = document.body.style.overflow;
        function close() {
            overlay.remove();
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', onKey, true);
            activeClose = undefined;
        }
        function button(label, text, css, action) {
            const b = document.createElement('button');
            b.type = 'button'; b.setAttribute('aria-label', label); b.textContent = text;
            b.style.cssText = 'position:absolute;background:#222d;color:white;border:1px solid #666;border-radius:12px;padding:12px 18px;font:24px sans-serif;cursor:pointer;' + css;
            b.addEventListener('click', action); overlay.appendChild(b);
        }
        button('Previous photo', '‹', 'left:12px;top:50%;', () => show(-1));
        button('Next photo', '›', 'right:12px;top:50%;', () => show(1));
        button('Close large photos', '×', 'right:12px;top:12px;', close);
        function onKey(e) {
            if (!['Escape','ArrowLeft','ArrowRight'].includes(e.key)) return;
            e.preventDefault(); e.stopImmediatePropagation();
            if (e.key === 'Escape') close();
            else show(e.key === 'ArrowRight' ? 1 : -1);
        }
        // Leave trackpad pinch and two-finger panning to Chrome.
        // Close the site's scrolling strip after collecting its actual photos.
        root.querySelector('button[aria-label="Close"]')?.click();
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', onKey, true);
        activeClose = close; show(); overlay.focus();
    }
    function stayInTab() {
        const root = this;
        requestAnimationFrame(() => openPhotos(root));
        return Promise.resolve();
    }
    for (const name of ['requestFullscreen','webkitRequestFullscreen','webkitRequestFullScreen']) {
        if (typeof Element.prototype[name] === 'function') {
            Object.defineProperty(Element.prototype, name, {configurable:true,writable:true,value:stayInTab});
        }
    }
})();
