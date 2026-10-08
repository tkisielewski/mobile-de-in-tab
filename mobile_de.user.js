// ==UserScript==
// @name         mobile.de - windowed large photo
// @version      2.7
// @updateURL    https://raw.githubusercontent.com/tkisielewski/mobile-de-in-tab/main/mobile_de.user.js
// @downloadURL  https://raw.githubusercontent.com/tkisielewski/mobile-de-in-tab/main/mobile_de.user.js
// @description  Opens the clicked ad photo in a large viewer inside the current tab for side-by-side comparison. Navigate with arrow buttons or keyboard keys, wrap between the first and last photo, and close with Escape or ×. Save all gallery photos as numbered files with progress, cancellation, and retry. Supports Chrome page zoom with Ctrl + mouse wheel, plus trackpad pinch zoom and two-finger panning.
// @match        https://suchen.mobile.de/*
// @match        https://www.mobile.de/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        unsafeWindow
// @connect      img.classistatic.de
// @sandbox      raw
// ==/UserScript==
(() => {
    'use strict';
    let activeClose;
    let clickedPhoto;
    const page = unsafeWindow;
    const imageExtensions = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif'};
    function savePhoto(photo, name, job) {
        return new Promise((resolve, reject) => {
            const fail = error => reject(new Error(error?.error || error?.message || 'Download failed'));
            job.abort = () => reject(new Error('Cancelled'));
            const request = GM_xmlhttpRequest({
                method: 'GET', url: photo.src, responseType: 'blob', timeout: 60000,
                onerror: fail, ontimeout: () => fail(new Error('Image request timed out')),
                onload: response => {
                    if (job.cancelled) return fail(new Error('Cancelled'));
                    const blob = response.response;
                    const extension = imageExtensions[blob?.type?.split(';')[0].toLowerCase()];
                    if (response.status !== 200 || !blob?.size || !extension) {
                        return fail(new Error('Server did not return a supported image'));
                    }
                    try {
                        const download = GM_download({
                            url: blob, name: name + '.' + extension, saveAs: false,
                            conflictAction: 'uniquify',
                            onload: resolve, onerror: fail,
                            ontimeout: () => fail(new Error('Saving image timed out'))
                        });
                        job.abort = () => { download?.abort(); fail(new Error('Cancelled')); };
                    } catch (error) { fail(error); }
                }
            });
            job.abort = () => { request?.abort(); fail(new Error('Cancelled')); };
        });
    }
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
            if (url.protocol !== 'https:' || url.hostname !== 'img.classistatic.de') continue;
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
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#111;overflow:auto;';
        const image = document.createElement('img');
        image.style.cssText = 'position:static!important;display:block!important;max-width:none!important;max-height:none!important;object-fit:contain!important;margin:auto!important;';
        const stage = document.createElement('div');
        stage.style.cssText = 'min-width:100%;min-height:100%;display:grid;place-items:center;';
        stage.appendChild(image);
        overlay.appendChild(stage);
        const initialPixelRatio = window.devicePixelRatio || 1;
        function sizePhoto() {
            // Page zoom reduces CSS viewport dimensions and increases devicePixelRatio.
            // Compensate for that reduction so the photo grows with browser zoom.
            const zoom = (window.devicePixelRatio || 1) / initialPixelRatio;
            image.style.setProperty('width', window.innerWidth * zoom + 'px', 'important');
            image.style.setProperty('height', window.innerHeight * zoom + 'px', 'important');
        }
        sizePhoto();
        window.addEventListener('resize', sizePhoto);
        const counter = document.createElement('span');
        counter.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:#111c;color:white;padding:6px 12px;border-radius:8px;font:16px sans-serif;';
        overlay.appendChild(counter);
        function show(delta = 0) {
            selected = (selected + delta + photos.length) % photos.length;
            overlay.scrollTop = 0;
            overlay.scrollLeft = 0;
            image.src = photos[selected].src;
            image.alt = photos[selected].alt;
            counter.textContent = (selected + 1) + ' / ' + photos.length;
        }
        const previousOverflow = document.body.style.overflow;
        let downloadJob;
        function cancelDownloads() {
            if (!downloadJob) return;
            downloadJob.cancelled = true;
            downloadJob.abort?.();
        }
        function close() {
            cancelDownloads();
            window.removeEventListener('resize', sizePhoto);
            overlay.remove();
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', onKey, true);
            activeClose = undefined;
        }
        function button(label, text, css, action) {
            const b = document.createElement('button');
            b.type = 'button'; b.setAttribute('aria-label', label); b.textContent = text;
            b.style.cssText = 'position:fixed;background:#222d;color:white;border:1px solid #666;border-radius:12px;padding:12px 18px;font:24px sans-serif;cursor:pointer;' + css;
            b.addEventListener('click', action); overlay.appendChild(b);
            return b;
        }
        button('Previous photo', '‹', 'left:12px;top:50%;', () => show(-1));
        button('Next photo', '›', 'right:12px;top:50%;', () => show(1));
        button('Close large photos', '×', 'right:12px;top:12px;', close);
        const downloadStatus = document.createElement('span');
        downloadStatus.setAttribute('role', 'status');
        downloadStatus.style.cssText = 'position:fixed;top:80px;left:12px;max-width:75%;background:#111e;color:white;padding:8px;font:16px sans-serif;';
        overlay.appendChild(downloadStatus);
        const savedPhotos = new Set();
        const saveButton = button('Save all photos', 'Save all photos', 'left:12px;top:12px;font-size:16px;', async () => {
            if (downloadJob) return;
            const job = {cancelled: false};
            downloadJob = job;
            saveButton.disabled = true;
            cancelButton.hidden = false;
            const adId = new URL(location.href).searchParams.get('id')?.replace(/[^a-zA-Z0-9_-]/g, '') || 'ad';
            const failures = [];
            try {
                for (let i = 0; i < photos.length && !job.cancelled; i++) {
                    if (savedPhotos.has(i)) continue;
                    downloadStatus.textContent = 'Saving photo ' + (i + 1) + ' of ' + photos.length + '…';
                    try {
                        await savePhoto(photos[i], 'mobile-de-' + adId + '-' + String(i + 1).padStart(3, '0'), job);
                        savedPhotos.add(i);
                    } catch (error) {
                        if (job.cancelled) break;
                        failures.push((i + 1) + ': ' + error.message);
                        // These errors affect every file; stop instead of repeating them.
                        if (/not_enabled|not_permitted|not_supported|not_whitelisted/.test(error.message)) break;
                    }
                }
                downloadStatus.textContent = (job.cancelled ? 'Cancelled. ' : '') + savedPhotos.size + ' of ' + photos.length + ' photos saved.'
                    + (failures.length ? ' Failed: ' + failures.join('; ') + '. Check Tampermonkey download permissions, then retry.' : '');
            } finally {
                downloadJob = undefined;
                cancelButton.hidden = true;
                saveButton.disabled = savedPhotos.size === photos.length;
                saveButton.textContent = savedPhotos.size === photos.length ? 'All photos saved' : 'Save remaining photos';
            }
        });
        const cancelButton = button('Cancel downloads', 'Cancel', 'left:200px;top:12px;font-size:16px;', cancelDownloads);
        cancelButton.hidden = true;
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
        if (typeof page.Element.prototype[name] === 'function') {
            Object.defineProperty(page.Element.prototype, name, {configurable:true,writable:true,value:stayInTab});
        }
    }
})();
