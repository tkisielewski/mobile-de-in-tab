// ==UserScript==
// @name         mobile.de – Ad Tools
// @version      2.10
// @updateURL    https://raw.githubusercontent.com/tkisielewski/mobile-de-in-tab/main/mobile_de.user.js
// @downloadURL  https://raw.githubusercontent.com/tkisielewski/mobile-de-in-tab/main/mobile_de.user.js
// @description  Opens the clicked ad photo in a large viewer inside the current tab for side-by-side comparison. Navigate with arrow buttons or keyboard keys, wrap between the first and last photo, and close with Escape or ×. Save all gallery photos as numbered files with progress, cancellation, and retry. Supports Chrome page zoom with Ctrl + mouse wheel, plus trackpad pinch zoom and two-finger panning. Click ad locations to open Google Maps driving directions in a new tab. Translate seller descriptions in-place with automatic language detection, a saved target language, optional automatic translation, preserved formatting, and original text restore.
// @match        https://suchen.mobile.de/*
// @match        https://www.mobile.de/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      img.classistatic.de
// @sandbox      raw
// ==/UserScript==
(() => {
    'use strict';
    let activeClose;
    let clickedPhoto;
    const page = unsafeWindow;

    const translationLanguages = 'ar bg bn cs da de el en es fi fr he hi hr hu id it ja kn ko lt lv mr ms nl no pl pt ro ru sk sl sv ta te th tr uk vi zh zh-Hant'.split(' ');
    const languageNames = new Intl.DisplayNames(['en'], {type: 'language'});
    const languageName = code => languageNames.of(code) || code;
    const savedTarget = GM_getValue('translationTarget', 'pl');
    const translationPreferences = {
        target: translationLanguages.includes(savedTarget) ? savedTarget : 'pl',
        automatic: GM_getValue('translationAutomatic', false) === true
    };
    const descriptionControls = new WeakMap();
    async function translateDescription(texts, status, targetLanguage) {
        if (!page.LanguageDetector || !page.Translator) {
            throw new Error('This Chrome version does not support description translation. Update Chrome and try again.');
        }
        let detector, translator;
        const monitor = model => model.addEventListener('downloadprogress', event => {
            status.textContent = 'Downloading translation model… ' + Math.round(event.loaded * 100) + '%';
        });
        try {
            status.textContent = 'Detecting description language…';
            detector = await page.LanguageDetector.create({monitor});
            const languages = await detector.detect(texts.join('\n'));
            const sourceLanguage = languages[0]?.detectedLanguage;
            if (!sourceLanguage || sourceLanguage === 'und') throw new Error('Could not detect the description language.');
            if (sourceLanguage === targetLanguage) return texts;
            const options = {sourceLanguage, targetLanguage};
            if (await page.Translator.availability(options) === 'unavailable') {
                throw new Error('Chrome cannot translate this language into ' + languageName(targetLanguage) + '.');
            }
            translator = await page.Translator.create({...options, monitor});
            const results = [];
            for (const text of texts) {
                status.textContent = 'Translating to ' + languageName(targetLanguage) + '… ' + (results.length + 1) + ' / ' + texts.length;
                const result = await translator.translate(text.trim());
                if (!result?.trim()) throw new Error('Translation returned no text. Try again.');
                // Keep spacing around inline markup such as bold text and links.
                results.push(text.match(/^\s*/)[0] + result.trim() + text.match(/\s*$/)[0]);
            }
            return results;
        } finally {
            detector?.destroy();
            translator?.destroy();
        }
    }
    function addDescriptionTranslation() {
        for (const description of document.querySelectorAll('[data-testid="vip-vehicle-description-text"]')) {
            const existing = descriptionControls.get(description);
            if (existing?.isConnected) continue;
            const section = description.closest('section');
            const heading = section?.querySelector('h2,h3');
            if (!heading) continue;
            const controls = document.createElement('div');
            controls.className = 'notranslate';
            controls.style.cssText = 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0;';
            const button = document.createElement('button');
            button.type = 'button';
            const translateLabel = () => 'Translate description to ' + languageName(target.value);
            const target = document.createElement('select');
            target.setAttribute('aria-label', 'Translation language');
            target.style.cssText = 'font:inherit;padding:8px;color:inherit;background:transparent;border:1px solid #888;border-radius:6px;';
            for (const code of translationLanguages) {
                const option = document.createElement('option');
                option.value = code; option.textContent = languageName(code);
                target.appendChild(option);
            }
            target.value = translationPreferences.target;
            button.textContent = translateLabel();
            button.style.cssText = 'padding:8px 12px;border:1px solid #888;border-radius:6px;color:inherit;background:transparent;cursor:pointer;font:inherit;';
            const status = document.createElement('span');
            status.setAttribute('role', 'status');
            const automaticLabel = document.createElement('label');
            const automatic = document.createElement('input');
            automatic.type = 'checkbox';
            automatic.checked = translationPreferences.automatic;
            automaticLabel.append(automatic, ' Automatically translate descriptions');
            controls.append(button, target, automaticLabel, status);
            heading.after(controls);
            descriptionControls.set(description, controls);
            let showingTranslation = false;
            let savedNodes = [];
            let cachedText, cachedTranslation;
            let originalLanguage;
            let hadNoTranslate;
            async function runTranslation() {
                if (button.disabled) return;
                if (showingTranslation) {
                    for (const entry of savedNodes) {
                        if (description.contains(entry.node) && entry.node.textContent === entry.translated) {
                            entry.node.textContent = entry.original;
                        }
                    }
                    if (originalLanguage === null) description.removeAttribute('lang');
                    else description.setAttribute('lang', originalLanguage);
                    if (!hadNoTranslate) description.classList.remove('notranslate');
                    showingTranslation = false;
                    button.textContent = translateLabel();
                    status.textContent = '';
                    return;
                }
                const walker = document.createTreeWalker(description, NodeFilter.SHOW_TEXT);
                const nodes = [];
                while (walker.nextNode()) {
                    const node = walker.currentNode;
                    if (node.textContent.trim() && !node.parentElement?.closest('script, style, button')) nodes.push(node);
                }
                const texts = nodes.map(node => node.textContent);
                const targetLanguage = target.value;
                const text = JSON.stringify([targetLanguage, texts]);
                if (!nodes.length) { status.textContent = 'The description is empty.'; return; }
                button.disabled = true;
                target.disabled = true;
                try {
                    const result = cachedText === text ? cachedTranslation : await translateDescription(texts, status, targetLanguage);
                    // A new listing or site rerender must not receive an old translation.
                    if (!description.isConnected || nodes.some((node, i) => !description.contains(node) || node.textContent !== texts[i])) {
                        status.textContent = 'Description changed. Click again to translate it.';
                        return;
                    }
                    cachedText = text;
                    cachedTranslation = result;
                    originalLanguage = description.getAttribute('lang');
                    hadNoTranslate = description.classList.contains('notranslate');
                    description.classList.add('notranslate');
                    description.lang = targetLanguage;
                    savedNodes = nodes.map((node, i) => ({node, original: texts[i], translated: result[i]}));
                    // Change only text nodes: lists, emphasis, links and line breaks stay intact.
                    for (const entry of savedNodes) entry.node.textContent = entry.translated;
                    showingTranslation = true;
                    button.textContent = 'Show original description';
                    status.textContent = languageName(targetLanguage) + ' · automatically detected source language';
                } catch (error) {
                    status.textContent = error.name === 'NotAllowedError'
                        ? 'Chrome needs another click to start the language model. Try again.'
                        : 'Translation failed: ' + error.message;
                } finally { button.disabled = false; target.disabled = false; }
            }
            button.addEventListener('click', runTranslation);
            target.addEventListener('change', async () => {
                translationPreferences.target = target.value;
                GM_setValue('translationTarget', target.value);
                if (showingTranslation) await runTranslation();
                button.textContent = translateLabel();
                cachedText = undefined;
                if (automatic.checked) await runTranslation();
            });
            automatic.addEventListener('change', () => {
                translationPreferences.automatic = automatic.checked;
                GM_setValue('translationAutomatic', automatic.checked);
                if (automatic.checked && !showingTranslation) runTranslation();
            });
            // Attempt once per new description. Model setup may still require a click.
            if (automatic.checked) runTranslation();
        }
    }

    function locationDirections(text) {
        const match = text.trim().match(/^([A-Z]{2})-(\d{2,6}(?:-\d{2,4})?)\s+([\p{L}][\p{L}\p{M}\d .,'’()/\-]{0,100})$/u);
        if (!match) return null;
        const url = new URL('https://www.google.com/maps/dir/');
        url.searchParams.set('api', '1');
        url.searchParams.set('destination', match[2] + ' ' + match[3] + ', ' + match[1]);
        url.searchParams.set('travelmode', 'driving');
        return url.href;
    }
    function linkLocations() {
        if (!document.body) return;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const locations = [];
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node.parentElement?.closest('a, button, script, style, textarea, input, select, [contenteditable], [role="dialog"]')) continue;
            const href = locationDirections(node.textContent);
            if (href) locations.push({node, href});
        }
        for (const {node, href} of locations) {
            const link = document.createElement('a');
            link.href = href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = node.textContent;
            link.title = 'Show driving distance in Google Maps';
            link.style.cssText = 'color:inherit;text-decoration:underline;cursor:pointer;';
            link.addEventListener('click', event => event.stopPropagation());
            node.replaceWith(link);
        }
    }
    let locationUpdatePending = false;
    function scheduleLocationLinks() {
        if (locationUpdatePending) return;
        locationUpdatePending = true;
        requestAnimationFrame(() => {
            locationUpdatePending = false;
            linkLocations();
            addDescriptionTranslation();
        });
    }
    // Listings load asynchronously and can change without a full page reload.
    new MutationObserver(scheduleLocationLinks).observe(document.documentElement, {childList: true, subtree: true, characterData: true});
    scheduleLocationLinks();

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
