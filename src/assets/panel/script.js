const defaultHttpsPorts = [443, 8443, 2053, 2083, 2087, 2096];
const defaultHttpPorts = [80, 8080, 8880, 2052, 2082, 2086, 2095];
const proxyForm = document.getElementById('configForm');
const [
    selectElements,
    numInputElements,
    inputElements,
    textareaElements,
    checkboxElements
] = [
    'select',
    'input[type=number]',
    'input:not([type=file])',
    'textarea',
    'input[type=checkbox]'
].map(query => proxyForm.querySelectorAll(query));

localStorage.getItem('darkMode') === 'enabled' && document.body.classList.add('dark-mode');
getUsage();
initPanel().then(fetchIPInfo);

async function initPanel(settings, tgSettings, subscriptions, clients) {
    try {
        if (!settings) {
            const nocache = Date.now();
            const res = await fetch(`./panel/settings?nocache=${nocache}`, { cache: 'no-store' });
            const { success, status, message, body } = await res.json();

            if (status === 401 && !body.isPassSet) {
                const closeBtn = document.querySelector('.modal-close');
                openResetPass();
                closeBtn.style.visibility = 'hidden';
            }

            if (!success) throw new Error(`status ${status} - ${message}`);

            settings = body.proxySettings;
            tgSettings = body.telegramSettings;
            subscriptions = body.subscriptions;
            clients = body.clients;
            checkVersion(settings.panelVersion);
        }

        renderPanel(settings, tgSettings, subscriptions, clients);

        await loadCloudflareConfig();
        await loadBackgroundOnInit();
        fetchcloudflareInfo();
        setInterval(updateCountdown, 1000);
        updateCountdown();
        updateLinks();
    } catch (error) {
        console.error('Panel initiation error:', error);
    }
}

/* ============ Usage ============ */
async function getUsage() {
    try {
        const res = await fetch(`./panel/usage?nocache=${Date.now()}`, { cache: 'no-store' });
        const { success, status, message, body } = await res.json();
        if (!success) throw new Error(`status ${status} - ${message}`);
        const { total, worker } = body;
        document.getElementById('total-usage').textContent = total.toLocaleString('en-US');
        const totalPct = document.getElementById('total-pct');
        const totalPctVal = Math.ceil(Number(total) / 100000 * 100);
        totalPct.textContent = totalPctVal;
        if (totalPctVal > 80) totalPct.style.color = 'var(--color-icon-red)';
        document.getElementById('panel-usage').textContent = worker.toLocaleString('en-US');
        const panelPct = document.getElementById('panel-pct');
        const panelPctVal = Math.ceil(Number(worker) / 100000 * 100);
        panelPct.textContent = panelPctVal;
        if (panelPctVal > 80) panelPct.style.color = 'var(--color-icon-red)';
    } catch (error) {
        console.error('Failed to get usage:', error);
    }
}

async function checkVersion(panelVersion) {
    try {
        const res = await fetch('https://raw.githubusercontent.com/bia-pain-bache/BPB-Worker-Panel/refs/heads/main/package.json', { cache: 'no-store' });
        if (!res.ok) return;
        const pkg = await res.json();
        if (isNewerVersion(pkg.version, panelVersion)) {
            globalThis.latestVersion = pkg.version;
            document.getElementById('updatePanel').disabled = false;
        }
    } catch (error) {
        console.error('Get latest version error:', error);
    }
}

function isNewerVersion(latest, current) {
    const lv = latest.split('.').map(Number);
    const cv = current.split('.').map(Number);
    for (let i = 0; i < Math.max(lv.length, cv.length); i++) {
        const l = lv[i] ?? 0;
        const c = cv[i] ?? 0;
        if (l > c) return true;
        if (l < c) return false;
    }
    return false;
}

/* ============ Render ============ */
function renderPanel(proxySettings, tgSettings, subscriptions, clients) {
    const {
        securePath, ports, xrayUdpNoises, remoteSettings,
        customGroups, linkIPs, linkUrl
    } = proxySettings;

    globalThis.customGroups = customGroups || [];
    renderCustomGroups();
    renderLinkIPs(linkIPs);

    const path = encodeURIComponent(securePath);
    if (path && path !== window.location.pathname.split('/')[1]) {
        setTimeout(() => { window.location.href = `../${path}/panel`; }, 1000);
    }

    const dohUrl = new URL(`./dns-query`, window.location.href);
    document.getElementById('doh').textContent = dohUrl.href;
    document.getElementById('fetchSettingsBtn').disabled = !remoteSettings;

    // 不属于 proxySettings 的字段跳过
    const externalIds = new Set([
        'cfAccountId', 'cfApiToken', 'cfEmail', 'cfGlobalApiKey', 'cfQueryUrl',
        'bgImageInput', 'bgOpacityInput', 'bgPositionSelect',
        'telegramBotToken', 'telegramUserId', 'username', 'newPassword', 'confirmPassword'
    ]);

    selectElements.forEach(elm => {
        if (externalIds.has(elm.id)) return;
        elm.value = proxySettings[elm.id];
    });
    checkboxElements.forEach(elm => elm.checked = proxySettings[elm.id]);
    inputElements.forEach(elm => {
        if (externalIds.has(elm.id)) return;
        elm.value = proxySettings[elm.id] || '';
    });
    textareaElements.forEach(elm => {
        const key = elm.id;
        const element = document.getElementById(key);
        if (key === 'linkUrl') {
            element.value = proxySettings[key] || '';
            element.style.height = 'auto';
            element.style.height = `${element.scrollHeight}px`;
            element.addEventListener('input', () => {
                element.style.height = 'auto';
                element.style.height = `${element.scrollHeight}px`;
            });
            return;
        }
        const value = proxySettings[key]?.join('\r\n');
        const rowsCount = (proxySettings[key] || []).length;
        element.style.height = 'auto';
        if (rowsCount) element.rows = rowsCount;
        element.value = value || '';
        elm.addEventListener('input', () => {
            elm.style.height = 'auto';
            elm.style.height = `${elm.scrollHeight}px`;
        });
    });

    renderPorts(ports.map(Number));
    renderNoises(xrayUdpNoises);
    renderSubscriptions(subscriptions);
    renderClients(clients);

    globalThis.initialFormData = new FormData(proxyForm);
    handleProxyFormChanges();
    proxyForm.addEventListener('input', handleProxyFormChanges);
    proxyForm.addEventListener('change', handleProxyFormChanges);
    handleFragmentMode();

    if (tgSettings) {
        const tgForm = document.getElementById('telegramForm');
        handleTgFormChanges(tgSettings);
        tgForm.addEventListener('input', () => handleTgFormChanges());
        for (const key in tgSettings) {
            if (tgForm.elements[key]) tgForm.elements[key].value = tgSettings[key];
        }
    }
}

function hasFormDataChanged() {
    const toObj = fd => Object.fromEntries(fd.entries());
    const current = new FormData(proxyForm);
    return JSON.stringify(toObj(globalThis.initialFormData)) !== JSON.stringify(toObj(current));
}

function handleProxyFormChanges(force = false) {
    const btn = document.getElementById('applyButton');
    btn.disabled = force ? false : !hasFormDataChanged();
}

function handleTgFormChanges(settings) {
    const userId = document.getElementById('telegramUserId');
    const token = document.getElementById('telegramBotToken');
    const setupBtn = document.getElementById('setup-telegram');
    const removeBtn = document.getElementById('remove-telegram');
    if (settings) {
        removeBtn.disabled = !settings.telegramUserId && !settings.telegramBotToken;
        setupBtn.disabled = true;
        userId.value = settings.telegramUserId;
        token.value = settings.telegramBotToken;
        return;
    }
    setupBtn.disabled = !userId.value.trim() || !token.value.trim();
}

/* ============ IP Info ============ */
async function getIpDetails(ip) {
    try {
        const r = await fetch('./panel/my-ip', { method: 'POST', body: ip });
        const { success, status, message, body } = await r.json();
        if (!success) throw new Error(`status ${status} - ${message}`);
        return body;
    } catch (e) {
        console.error('Fetching IP error:', e);
    }
}

async function fetchIPInfo() {
    const updateUI = (ip, country, countryCode, city, isp, cfIP) => {
        const flag = countryCode !== '-' ? String.fromCodePoint(...[...countryCode].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '';
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set(cfIP ? 'cf-ip' : 'ip', ip);
        set(cfIP ? 'cf-country' : 'country', `${flag} ${country}`);
        set(cfIP ? 'cf-city' : 'city', city);
        set(cfIP ? 'cf-isp' : 'isp', isp);
    };
    const nocache = Date.now();
    await Promise.allSettled([
        fetch(`https://ipv4.geojs.io/v1/ip.json?nocache=${nocache}`, { cache: 'no-store' }).then(async res => {
            const { ip } = await res.json();
            const d = await getIpDetails(ip);
            updateUI(ip, d.country, d.countryCode, d.city, d.isp);
        }),
        fetch(`https://ipv4.icanhazip.com/?nocache=${nocache}`, { cache: 'no-store' }).then(async res => {
            const ip = (await res.text()).trim();
            const d = await getIpDetails(ip);
            updateUI(ip, d.country, d.countryCode, d.city, d.isp, true);
        })
    ]);
}

/* ============ Subscriptions ============ */
function generateSubUrl(type, core, tag, useLink = false) {
    const url = new URL(`./sub/${type}`, window.location.href);
    url.searchParams.append('app', core);
    if (useLink) url.searchParams.append('link', '');
    url.hash = `💦 BPB ${tag}`;
    if (core === 'sing-box' && type !== 'raw') {
        return `sing-box://import-remote-profile?url=${url.href}`;
    }
    return url.href;
}

async function generateQRCode(data) {
    const url = new URL('./qrcode', window.location.href);
    url.searchParams.set('data', data);
    url.searchParams.set('nocache', Date.now().toString());
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const blob = await res.blob();
    return elm('img', { id: 'qr', className: 'qrcode', src: URL.createObjectURL(blob) });
}

function showQRCode(subUrl) {
    const url = new URL(subUrl);
    const modal = document.getElementById('qrModal');
    const close = modal.querySelector('.modal-close');
    const container = document.getElementById('qrcode-container');
    document.getElementById('qrcodeTitle').textContent = decodeURIComponent(url.hash).replace('#', '');
    close.onclick = () => { modal.hidden = true; container.lastElementChild.remove(); };
    window.onclick = (e) => { if (e.target === modal) { modal.hidden = true; container.lastElementChild.remove(); } };
    generateQRCode(subUrl).then(qr => { container.appendChild(qr); modal.hidden = false; });
}

function copyToClipboard(url) {
    navigator.clipboard.writeText(url).then(() => notify('info', 'Copied', [url])).catch(console.error);
}

function copyDoh() { copyToClipboard(document.getElementById('doh').textContent); }

async function dlUrl(subUrl) {
    const url = new URL(subUrl);
    window.location.href = url.protocol === 'sing-box:' ? url.searchParams.get('url') : subUrl;
}

/* ============ Import / Export ============ */
async function exportFileSettings(event) {
    if (hasFormDataChanged()) return notify('error', 'Export', ['Please apply unsaved changes first.']);
    const url = new URL('./sub/share-settings', window.location.href);
    window.location.href = url.href;
}

function importFile() {
    const input = document.getElementById('fileInput');
    input.value = '';
    input.click();
}

async function importFileSettings(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        const data = atob(await file.text());
        const newSettings = JSON.parse(data);
        const current = validateSettings();
        renderPanel({ ...current, ...newSettings });
        handleProxyFormChanges(true);
        notify('success', 'Import', ['Imported successfully!']);
    } catch (e) {
        notify('error', 'Import', ['Failed to import.']);
    }
}

async function importRemoteSettings(event) {
    if (hasFormDataChanged()) return notify('error', 'Import', ['Please apply unsaved changes first.']);
    const remote = document.getElementById('remoteSettings').value.trim();
    try {
        const url = new URL(remote);
        const r = await fetch(`${url.origin + url.pathname}?nocache=${Date.now()}`, { cache: 'no-store' });
        const newSettings = JSON.parse(atob(await r.text()));
        const current = validateSettings();
        renderPanel({ ...current, ...newSettings });
        handleProxyFormChanges(true);
        notify('success', 'Import', ['Imported successfully!']);
    } catch (e) {
        notify('error', 'Import', ['Failed to import from remote.']);
    }
}

function shareSettings() {
    copyToClipboard(new URL('./sub/share-settings', window.location.href));
}

/* ============ Warp / Telegram / Panel ============ */
async function renewWarpAccounts() {
    const ok = await notify('confirm', 'Renew Warp', ['Are you sure?']);
    if (!ok) return;
    try {
        const r = await fetch('./panel/update-warp', { method: 'POST', credentials: 'include' });
        const { success, status, message } = await r.json();
        if (!success) throw new Error(`status ${status} - ${message}`);
        notify('success', 'Renew Warp', ['Warp accounts updated successfully!']);
    } catch (e) {
        notify('error', 'Renew Warp', ['Failed to renew.']);
    }
}

async function handleRiskyRules(event) {
    if (event.target.checked) {
        const ok = await notify('confirm', 'Geo Assets', [
            "v2ray users should set Geo Assets to Chocolate4U and download assets, otherwise configs won't connect.",
            'Proceed?'
        ]);
        if (!ok) event.target.checked = false;
    }
}

function handleFragmentMode() {
    const mode = document.getElementById('fragmentMode').value;
    const initial = Object.fromEntries(globalThis.initialFormData.entries());
    const inputs = ['fragmentLengthMin', 'fragmentLengthMax', 'fragmentDelayMin', 'fragmentDelayMax'];
    const configs = {
        low: [100, 200, 1, 1],
        medium: [50, 100, 1, 5],
        high: [10, 20, 10, 20],
        severe: [1, 5, 1, 5],
        custom: inputs.map(id => initial[id])
    };
    inputs.forEach((id, i) => {
        const el = document.getElementById(id);
        el.value = configs[mode][i];
        mode !== 'custom' ? el.setAttribute('readonly', 'true') : el.removeAttribute('readonly');
    });
}

async function resetSettings() {
    const ok = await notify('confirm', 'Reset', ['Reset all settings?']);
    if (!ok) return;
    try {
        const r = await fetch('./panel/reset-settings', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });
        const { success, status, message, body } = await r.json();
        if (!success) throw new Error(`status ${status} - ${message}`);
        notify('success', 'Reset', ['Please update subscriptions.']);
        renderPanel(body);
    } catch (e) {
        console.error('Reset settings error:', e);
    }
}

function updateSettings(event) {
    event.preventDefault();
    event.stopPropagation();
    const form = validateSettings();
    if (!form) return false;
    const btn = document.getElementById('applyButton');
    const init = btn.value;
    btn.value = '⌛';
    fetch('./panel/update-settings', {
        method: 'PUT',
        body: JSON.stringify(form),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(r => r.json())
    .then(({ success, status, message, body: errors }) => {
        if (status === 401) { window.location.href = './login'; return; }
        if (!success) {
            if (Array.isArray(errors)) errors.forEach(err => notify('error', err.field, err.message));
            throw new Error(`status ${status} - ${message}`);
        }
        notify('success', 'Apply', ['Please update subscriptions.']);
        renderPanel(form);
    })
    .catch(console.error)
    .finally(() => { btn.value = init; });
}

async function setupTelegramBot(event) {
    event.preventDefault();
    const formData = Object.fromEntries(new FormData(event.target).entries());
    try {
        const r = await fetch('./telegram/setup', {
            method: 'PUT',
            body: JSON.stringify(formData),
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });
        const { success, status, message, body } = await r.json();
        if (status === 401) { window.location.href = './login'; return; }
        if (!success) throw new Error(`status ${status} - ${message}`);
        handleTgFormChanges(body);
        notify('success', 'Telegram', ['Bot is ready.']);
    } catch (e) { console.error(e); }
}

async function removeTelegramBot() {
    try {
        const r = await fetch('./telegram/remove', { method: 'POST', credentials: 'include' });
        const { success, status, message, body } = await r.json();
        if (status === 401) { window.location.href = './login'; return; }
        if (!success) throw new Error(`status ${status} - ${message}`);
        handleTgFormChanges(body);
        notify('success', 'Telegram', ['Bot removed.']);
    } catch (e) { console.error(e); }
}

function validateSettings() {
    const fd = new FormData(proxyForm);
    const fields = ['udpXrayNoiseMode', 'udpXrayNoisePacket', 'udpXrayNoiseDelayMin', 'udpXrayNoiseDelayMax', 'udpXrayNoiseCount'].map(k => fd.getAll(k));
    const form = Object.fromEntries(fd.entries());
    const [modes, packets, delaysMin, delaysMax, counts] = fields;

    form.xrayUdpNoises = modes.map((mode, i) => ({
        type: mode, packet: packets[i], delay: `${delaysMin[i]}-${delaysMax[i]}`, count: counts[i]
    }));
    form.ports = [...defaultHttpPorts, ...defaultHttpsPorts].filter(p => fd.has(p.toString()));
    checkboxElements.forEach(el => { form[el.id] = fd.has(el.id); });
    selectElements.forEach(el => {
        let v = form[el.id];
        if (v === 'true') v = true;
        if (v === 'false') v = false;
        form[el.id] = v;
    });
    inputElements.forEach(el => { if (typeof form[el.id] === 'string') form[el.id] = form[el.id].trim(); });
    numInputElements.forEach(el => { form[el.id] = Number(form[el.id]?.trim() || 0); });
    textareaElements.forEach(el => {
        const k = el.id, v = form[k];
        if (k === 'linkUrl') form[k] = (typeof v === 'string' ? v : (v?.[0] || '')).trim();
        else form[k] = v?.split('\n').map(s => s.trim()).filter(Boolean) || [];
    });
    form.customGroups = globalThis.customGroups || [];
    return form;
}

/* ============ Password / Logout ============ */
function logout(event) {
    event.preventDefault();
    fetch('./panel/logout', { method: 'GET', credentials: 'same-origin' })
        .then(r => r.json())
        .then(({ success, status, message }) => {
            if (!success) throw new Error(`status ${status} - ${message}`);
            window.location.href = './login';
        })
        .catch(console.error);
}

function openResetPass() {
    const modal = document.getElementById('resetPassModal');
    const close = modal.querySelector('.modal-close');
    const showHides = modal.querySelectorAll('.show-hide');
    const form = modal.querySelector('.config-form');
    form.onsubmit = resetPassword;
    showHides.forEach(el => {
        el.onclick = () => {
            const input = el.previousElementSibling;
            const isPwd = input.type === 'password';
            input.type = isPwd ? 'text' : 'password';
            el.textContent = isPwd ? 'visibility' : 'visibility_off';
        };
    });
    close.onclick = () => modal.hidden = true;
    modal.hidden = false;
}

function resetPassword(event) {
    event.preventDefault();
    const passwordError = document.getElementById('passwordError');
    const password = document.getElementById('newPassword').value.trim();
    const confirm = document.getElementById('confirmPassword').value.trim();
    if (password !== confirm) { passwordError.textContent = 'Passwords do not match'; return; }
    if (!/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(password)) {
        passwordError.textContent = 'Need capital + number + 8 chars.';
        return;
    }
    fetch('./panel/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        credentials: 'same-origin',
        body: password
    })
    .then(r => r.json())
    .then(({ success, status, message }) => {
        if (!success) { passwordError.textContent = message; throw new Error(message); }
        notify('success', 'Reset Password', ['Password changed.']);
        window.location.href = './login';
    })
    .catch(console.error);
}

/* ============ Utilities ============ */
function genNoisePacket(mode, packet) {
    switch (mode.value) {
        case 'base64': packet.value = randBase64(32, 64); break;
        case 'rand': packet.value = '50-100'; break;
        case 'hex': packet.value = randHex(32, 64); break;
        case 'array': packet.value = randArray(32, 64); break;
        case 'str': packet.value = randString('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 32, 64); break;
    }
    handleProxyFormChanges();
}

function randUUID() { document.getElementById('vlUUID').value = crypto.randomUUID(); handleProxyFormChanges(); }
function randString(charset, minLen, maxLen) { return [...randBytes(minLen, maxLen)].map(b => charset[b % charset.length]).join(''); }
function randArray(minLen, maxLen) {
    const len = Math.floor(Math.random() * (maxLen - minLen + 1)) + minLen;
    return Array.from({ length: len }, () => Math.floor(Math.random() * 256)).join(',');
}
function randBytes(minBytes, maxBytes) {
    const n = Math.floor(Math.random() * (maxBytes - minBytes + 1)) + minBytes;
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return a;
}
function randHex(minB, maxB) { return [...randBytes(minB, maxB)].map(b => b.toString(16).padStart(2, '0')).join(''); }
function randBase64(minB, maxB) { return btoa(String.fromCharCode(...randBytes(minB, maxB))); }
function randPassword() {
    document.getElementById('trPass').value = randString('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@$&*_-+;:,.', 16, 32);
    handleProxyFormChanges();
}
function randPath() {
    document.getElementById('securePath').value = randString('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', 16, 32);
    handleProxyFormChanges();
}

async function updatePanel(btn) {
    const ok = await notify('confirm', 'Update BPB Panel', [
        `New version ${globalThis.latestVersion} available!`,
        'Read release notes before updating. Proceed?'
    ]);
    if (!ok) return;
    fetch('./panel/update-panel', { method: 'POST' })
        .then(r => r.json())
        .then(({ success, status, message }) => {
            if (!success) throw new Error(`status ${status} - ${message}`);
            notify('success', 'Update Panel', ['Upgraded! Reloading...']);
            setTimeout(() => location.reload(), 3000);
        })
        .catch(console.error);
}

async function deletePanel(btn) {
    const ok = await notify('confirm', 'Delete Panel', ['This will permanently delete your panel. Are you sure?']);
    if (!ok) return;
    fetch('./panel/delete-panel', { method: 'POST' })
        .then(r => r.json())
        .then(({ success, status, message }) => {
            if (!success) throw new Error(`status ${status} - ${message}`);
            notify('success', 'Delete Panel', ['Deleted!']);
        })
        .catch(console.error);
}

function notify(type, title, text) {
    return new Promise(resolve => {
        const fragment = document.getElementById('message-template').content.cloneNode(true);
        const modal = fragment.querySelector('.modal');
        modal.hidden = false;
        modal.querySelector('.message-title').textContent = title;
        modal.querySelector('.message-text').innerHTML = text.join('\n');
        const icon = modal.querySelector('.message-icon');
        const isOk = type === 'success' || type === 'info';
        icon.textContent = isOk ? 'check_circle' : type === 'confirm' ? 'help' : 'error';
        const okBtn = modal.querySelector('.message-ok-btn');
        const cancelBtn = modal.querySelector('.message-cancel-btn');
        const closeBtn = modal.querySelector('.modal-close');
        const handle = v => { modal.remove(); resolve(v); };
        if (type === 'confirm') cancelBtn.onclick = () => handle(false);
        else cancelBtn.style.display = 'none';
        if (type === 'info') okBtn.style.display = 'none';
        else okBtn.onclick = () => handle(true);
        closeBtn.onclick = () => handle(false);
        document.body.appendChild(fragment);
        if (type === 'info') { setTimeout(() => { modal.remove(); resolve(null); }, 1000); }
    });
}

function elm(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...[].concat(children));
    return node;
}
const createIcon = text => elm('span', { className: 'material-symbols-rounded', textContent: text });

function createFormControl(labelText, action) {
    const label = elm('span', { textContent: labelText }, action ? createIcon('refresh') : []);
    return elm('div', { className: 'form-control' }, [label, elm('div')]);
}

async function deleteNoise(event) {
    const ok = await notify('confirm', 'Delete Noise', ['Are you sure?']);
    if (!ok) return;
    event.target.closest('.inner-container').remove();
    handleProxyFormChanges();
}

function addNoise(isManual, noiseIndex, udpNoise) {
    const index = noiseIndex ?? document.getElementById('noises').childElementCount;
    const noise = udpNoise || { type: 'rand', packet: '50-100', delay: '1-5', count: 5 };
    const heading = elm('h4', { textContent: `Noise ${index + 1}` });
    const headerDiv = elm('div', { className: 'header-container' }, heading);
    if (index !== 0) {
        headerDiv.appendChild(elm('button', { type: 'button', className: 'delete-noise', onclick: deleteNoise }, createIcon('delete')));
    }
    const modes = [['base64','Base64'],['rand','Random'],['str','String'],['hex','Hex'],['array','Array']]
        .map(([v, l]) => elm('option', { value: v, textContent: l, selected: noise.type === v }));
    const modeSelect = elm('select', { name: 'udpXrayNoiseMode' }, modes);
    const modeControl = createFormControl('Mode');
    const sw = modeControl.querySelector('div');
    sw.className = 'select-wrapper';
    sw.append(modeSelect, createIcon('keyboard_arrow_down'));
    const packetInput = elm('input', { type: 'text', name: 'udpXrayNoisePacket', value: noise.packet });
    const packetControl = createFormControl('Packet', true);
    packetControl.querySelector('div').appendChild(packetInput);
    const genBtn = packetControl.querySelector('.material-symbols-rounded');
    modeSelect.onchange = genBtn.onclick = () => genNoisePacket(modeSelect, packetInput);
    const countInput = elm('input', { type: 'number', name: 'udpXrayNoiseCount', value: String(noise.count), min: '1', required: true });
    const countControl = createFormControl('Count');
    countControl.querySelector('div').appendChild(countInput);
    const [dMin, dMax] = noise.delay.split('-');
    const minMaxDiv = elm('div', { className: 'min-max' }, [
        elm('input', { type: 'number', name: 'udpXrayNoiseDelayMin', value: dMin, min: '1', required: true }),
        elm('span', { textContent: ' - ' }),
        elm('input', { type: 'number', name: 'udpXrayNoiseDelayMax', value: dMax, min: '1', required: true })
    ]);
    const delayControl = createFormControl('Delay');
    delayControl.querySelector('div').appendChild(minMaxDiv);
    const section = elm('div', { className: 'section' }, [modeControl, packetControl, countControl, delayControl]);
    const container = elm('div', { className: 'inner-container' }, [headerDiv, section]);
    document.getElementById('noises').append(container);
    if (isManual) handleProxyFormChanges(true);
}

function renderPorts(ports) {
    const totalPorts = [...(window.origin.includes('workers.dev') ? defaultHttpPorts : []), ...defaultHttpsPorts];
    const tlsFragment = document.createDocumentFragment();
    const noneTlsFragment = document.createDocumentFragment();
    totalPorts.forEach(port => {
        const isHttps = defaultHttpsPorts.includes(port);
        const cb = elm('input', { type: 'checkbox', name: String(port), value: 'true', checked: ports.includes(port) });
        const wrapper = elm('div', { className: 'checkbox-wrapper' }, [cb, elm('span', { textContent: String(port) })]);
        (isHttps ? tlsFragment : noneTlsFragment).appendChild(wrapper);
    });
    const tls = document.getElementById('tls-ports');
    tls.innerHTML = ''; tls.appendChild(tlsFragment);
    if (noneTlsFragment.childElementCount > 0) {
        const nt = document.getElementById('non-tls-ports');
        nt.innerHTML = ''; nt.appendChild(noneTlsFragment);
        document.getElementById('none-tls').style.display = 'flex';
    }
}

function renderNoises(xrayUdpNoises) {
    document.getElementById('noises').innerHTML = '';
    (xrayUdpNoises || []).forEach((n, i) => addNoise(false, i, n));
}

function renderSubscriptions(subscriptions) {
    if (!subscriptions) return;
    for (const [type, { label, categories }] of Object.entries(subscriptions)) {
        const help = elm('a', {
            className: 'help-icon',
            href: `https://bia-pain-bache.github.io/BPB-Worker-Panel/usage/${type}/`,
            target: '_blank', title: 'Help'
        }, createIcon('info'));
        const section = elm('details', {}, elm('summary', {}, elm('h3', { textContent: label })));
        const table = elm('table', {}, categories.map(({ core, clients }) => {
            const clientSection = elm('td', {}, clients.map(c => elm('div', {}, [createIcon('verified'), elm('span', { textContent: c })])));
            const ctaSection = elm('td');
            const wgCore = ['wireguard', 'amnezia'].includes(core);
            if (!wgCore) {
                ctaSection.append(
                    elm('button', { title: 'QR', onclick: async () => {
                        const useLink = await showSubTypeModal();
                        if (useLink === null) return;
                        showQRCode(generateSubUrl(type, core, label, useLink));
                    }}, createIcon('qr_code')),
                    elm('button', { title: 'Copy', onclick: async () => {
                        const useLink = await showSubTypeModal();
                        if (useLink === null) return;
                        copyToClipboard(generateSubUrl(type, core, label, useLink));
                    }}, createIcon('content_copy'))
                );
            }
            if (type !== 'raw') {
                ctaSection.appendChild(elm('button', { title: 'Download', onclick: async () => {
                    const useLink = await showSubTypeModal();
                    if (useLink === null) return;
                    dlUrl(generateSubUrl(type, core, label, useLink));
                }}, createIcon('download')));
            }
            return elm('tr', {}, [clientSection, ctaSection]);
        }));
        section.appendChild(elm('div', { className: 'table-container' }, table));
        document.getElementById('subscriptions').appendChild(elm('div', { className: 'accordion-item' }, [section, help]));
    }
}

function renderClients(clients) {
    if (!clients) return;
    clients.forEach(client => {
        const row = elm('tr', {}, [
            elm('td', { textContent: client.name }),
            elm('td', { textContent: client.minVer }),
            elm('td', {}, [
                elm('span', { textContent: client.source }),
                elm('a', { href: atob(client.b64Url), target: '_blank', rel: 'noopener noreferrer' }, createIcon('download'))
            ])
        ]);
        document.getElementById('supported-clients').appendChild(row);
    });
}

/* ============ Cloudflare ============ */
async function fetchcloudflareInfo() {
    const [usageRes, kvRes] = await Promise.all([
        fetch('./panel/cloudflare-usage', { cache: 'no-store' }),
        fetch('./panel/kv-usage', { cache: 'no-store' })
    ]);
    updateCloudflareUI(await usageRes.json(), await kvRes.json());
}

function updateCloudflareUI(usageData, kvData) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('usage-status-emoji', usageData.success ? '🟢' : '🔴');
    set('kv-status-emoji', kvData.success ? '🟢' : '🔴');
    if (usageData.success && usageData.body) {
        set('cf-request-used', (usageData.body.total || 0).toLocaleString());
        set('cf-request-percent', (usageData.body.percentage || '0') + '%');
    }
    if (kvData.success && kvData.body) {
        set('cf-kv-read-used', (kvData.body.readTotal || 0).toLocaleString());
        set('cf-kv-read-percent', (kvData.body.readPercentage || '0') + '%');
        set('cf-kv-write-used', (kvData.body.writeTotal || 0).toLocaleString());
        set('cf-kv-write-percent', (kvData.body.writePercentage || '0') + '%');
        const details = kvData.body.details || [];
        const el = document.getElementById('cf-kv-details');
        if (el) {
            el.innerHTML = details.length
                ? details.map(ns => `<div style="padding:5px 0;"><strong>${ns.namespaceName}</strong><br>读: ${ns.read || 0} | 写: ${ns.write || 0} | 删: ${ns.delete || 0} | 列: ${ns.list || 0}</div>`).join('')
                : '暂无数据';
        }
    }
}

async function loadCloudflareConfig() {
    const r = await fetch('./panel/cloudflare-config');
    const d = await r.json();
    if (!d.success || !d.body) return;
    ['accountId','apiToken','email','globalApiKey','queryUrl'].forEach(k => {
        const el = document.getElementById('cf' + k.charAt(0).toUpperCase() + k.slice(1));
        if (el) el.value = d.body[k] || '';
    });
}

async function saveCloudflareConfig() {
    const cfg = {
        accountId: document.getElementById('cfAccountId').value.trim(),
        apiToken: document.getElementById('cfApiToken').value.trim(),
        email: document.getElementById('cfEmail').value.trim(),
        globalApiKey: document.getElementById('cfGlobalApiKey').value.trim(),
        queryUrl: document.getElementById('cfQueryUrl').value.trim()
    };
    if (!cfg.queryUrl && (!cfg.accountId || (!cfg.apiToken && (!cfg.email || !cfg.globalApiKey)))) {
        return notify('error', 'Cloudflare', ['请填写账号凭证或 Query URL']);
    }
    const r = await fetch('./panel/cloudflare-config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg)
    });
    const d = await r.json();
    if (d.success) { notify('success', 'Cloudflare', ['Saved']); setTimeout(fetchcloudflareInfo, 500); }
    else notify('error', 'Cloudflare', [d.message || 'Failed']);
}

async function clearCloudflareConfig() {
    if (!await notify('confirm', 'Cloudflare', ['Clear config?'])) return;
    const r = await fetch('./panel/cloudflare-config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: '', apiToken: '', email: '', globalApiKey: '', queryUrl: '' })
    });
    const d = await r.json();
    if (d.success) {
        ['cfAccountId','cfApiToken','cfEmail','cfGlobalApiKey','cfQueryUrl'].forEach(id => document.getElementById(id).value = '');
        notify('success', 'Cloudflare', ['Cleared']);
    }
}

/* ============ Background ============ */
async function loadBackgroundOnInit() {
    const r = await fetch('./panel/background-config');
    const d = await r.json();
    if (!d.success || !d.body) return;
    document.getElementById('bgImageInput').value = d.body.image || '';
    document.getElementById('bgPositionSelect').value = d.body.position || 'left';
    document.getElementById('bgOpacityInput').value = d.body.opacity || 0.9;
    globalThis.currentBgImage = d.body.image || '';
}

async function saveBackground() {
    const image = document.getElementById('bgImageInput').value.trim();
    const position = document.getElementById('bgPositionSelect').value;
    const opacity = parseFloat(document.getElementById('bgOpacityInput').value);
    if (!image) return notify('error', '背景', ['请输入图片地址']);
    if (isNaN(opacity) || opacity < 0 || opacity > 1) return notify('error', '背景', ['透明度需 0~1']);
    const r = await fetch('./panel/background-config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, position, opacity })
    });
    const d = await r.json();
    if (d.success) { applyBackgroundToPage(image, position, opacity); notify('success', '背景', ['已保存']); }
    else notify('error', '背景', [d.message || '保存失败']);
}

async function resetBackground() {
    if (!await notify('confirm', '背景', ['确定重置？'])) return;
    const r = await fetch('./panel/reset-background', { method: 'POST' });
    const d = await r.json();
    if (d.success) {
        const bg = d.body;
        document.getElementById('bgImageInput').value = bg.image;
        document.getElementById('bgPositionSelect').value = bg.position;
        document.getElementById('bgOpacityInput').value = bg.opacity;
        applyBackgroundToPage(bg.image, bg.position, bg.opacity);
        globalThis.currentBgImage = bg.image;
        notify('success', '背景', ['已重置']);
    }
}

function applyBackgroundToPage(image, position, opacity) {
    if (image !== globalThis.currentBgImage) {
        const newBg = /^https?:\/\//i.test(image) ? `/background-image?v=${Date.now()}` : image;
        document.body.style.setProperty('background-image', `url(${newBg})`, 'important');
        globalThis.currentBgImage = image;
    }
    document.body.style.setProperty('background-position', position, 'important');
    document.body.style.setProperty('background-size', 'cover', 'important');
    document.body.style.setProperty('background-attachment', 'fixed', 'important');
    document.querySelectorAll('.container-big').forEach(el => el.style.setProperty('opacity', opacity, 'important'));
}

function convertBgImageToBase64() {
    const file = document.getElementById('bgImageFile').files[0];
    if (!file) return;
    if (!file.type.match('image.*')) return notify('error', 'Base64', ['请选择图片']);
    if (file.size > 0.7 * 1024 * 1024) return notify('error', 'Base64', ['不能超过 700KB']);
    const reader = new FileReader();
    reader.onload = e => {
        document.getElementById('bgPreviewImg').src = e.target.result;
        document.getElementById('bgImagePreview').style.display = 'block';
        document.getElementById('bgBase64Result').value = e.target.result;
    };
    reader.readAsDataURL(file);
}

function copyBgBase64() {
    const v = document.getElementById('bgBase64Result').value;
    if (!v) return notify('error', 'Base64', ['没有内容']);
    navigator.clipboard.writeText(v).then(() => notify('info', 'Base64', ['已复制']));
}

function clearBgBase64() {
    document.getElementById('bgImageFile').value = '';
    document.getElementById('bgImagePreview').style.display = 'none';
    document.getElementById('bgBase64Result').value = '';
}

function applyBgBase64AsBackground() {
    const v = document.getElementById('bgBase64Result').value;
    if (!v) return notify('error', 'Base64', ['先生成 Base64']);
    document.getElementById('bgImageInput').value = v;
    notify('info', 'Base64', ['已填入，点击"保存"应用']);
}

document.getElementById('bgImageFile')?.addEventListener('change', convertBgImageToBase64);

/* ============ Link IPs ============ */
function renderLinkIPs(linkIPs) {
    const el = document.getElementById('linkIPsDisplay');
    if (el) el.textContent = linkIPs?.length ? linkIPs.join(', ') : '暂无链接节点';
}

/* ============ Subscription Type Modal ============ */
function showSubTypeModal() {
    return new Promise(resolve => {
        const modal = document.getElementById('subTypeModal');
        modal.hidden = false;
        document.getElementById('subTypeLink').onclick = () => { modal.hidden = true; resolve(true); };
        document.getElementById('subTypeClean').onclick = () => { modal.hidden = true; resolve(false); };
        modal.querySelector('.modal-close').onclick = () => { modal.hidden = true; resolve(null); };
    });
}

function closeSubTypeModal() { document.getElementById('subTypeModal').hidden = true; }

/* ============ Custom Groups ============ */
function renderCustomGroups() {
    const list = document.getElementById('customGroupList');
    if (!list) return;
    const groups = globalThis.customGroups || [];
    list.innerHTML = groups.length === 0
        ? '<div style="color:var(--hr-text-color);padding:8px;text-align:center;">暂无自定义分组</div>'
        : groups.map((g, i) => `
            <div class="custom-group-item">
                <input type="checkbox" class="group-checkbox" data-index="${i}">
                <span class="group-info"><strong>${escapeHtml(g.name)}</strong> — ${escapeHtml(g.url)}</span>
                <button type="button" class="delete-noise" onclick="removeCustomGroup(${i})">✕</button>
            </div>`).join('');
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function addCustomGroup() {
    const name = document.getElementById('newGroupName').value.trim();
    const url = document.getElementById('newGroupUrl').value.trim();
    if (!name || !url) return notify('error', 'Custom Groups', ['请填写完整']);
    globalThis.customGroups = globalThis.customGroups || [];
    globalThis.customGroups.push({ name, url });
    document.getElementById('newGroupName').value = '';
    document.getElementById('newGroupUrl').value = '';
    renderCustomGroups();
    handleProxyFormChanges(true);
}

function removeCustomGroup(i) {
    globalThis.customGroups.splice(i, 1);
    renderCustomGroups();
    handleProxyFormChanges(true);
}

function moveSelected(direction) {
    const checks = document.querySelectorAll('.group-checkbox:checked');
    if (!checks.length) return notify('error', 'Custom Groups', ['请先勾选']);
    const indices = Array.from(checks).map(cb => parseInt(cb.dataset.index)).sort((a, b) => a - b);
    const groups = globalThis.customGroups;
    const items = indices.map(i => groups[i]);
    const first = indices[0], last = indices[indices.length - 1], count = indices.length;
    [...indices].sort((a, b) => b - a).forEach(i => groups.splice(i, 1));
    let pos;
    if (direction === 'top') pos = 0;
    else if (direction === 'bottom') pos = groups.length;
    else if (direction === 'up') pos = Math.max(0, first - 1);
    else pos = Math.min(groups.length, last - count + 2);
    if (direction === 'bottom') groups.push(...items);
    else groups.splice(pos, 0, ...items);
    renderCustomGroups();
    handleProxyFormChanges(true);
}

/* ============ Dark Mode ============ */
async function darkModeToggle() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', isDark ? 'enabled' : 'disabled');
    await fetch('./panel/dark-mode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ darkMode: isDark })
    });
}

/* ============ UTC Countdown ============ */
function updateCountdown() {
    const now = new Date();
    const remaining = 86400000 - (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()) * 1000;
    const el = document.getElementById('resetCountdown');
    if (!el) return;
    const fmt = n => String(n).padStart(2, '0');
    el.textContent = `${fmt(Math.floor(remaining / 3600000))}:${fmt(Math.floor((remaining % 3600000) / 60000))}:${fmt(Math.floor((remaining % 60000) / 1000))}`;
}

/* ============ Dynamic Links ============ */
function updateLinks() {
    const hostname = window.location.hostname;
    if (hostname.includes('pages.dev') && hostname.includes('-')) {
        const dashIdx = hostname.indexOf('-');
        const dotIdx = hostname.indexOf('.');
        if (dashIdx !== -1 && dotIdx !== -1 && dashIdx < dotIdx) {
            const suffix = hostname.substring(dashIdx, dotIdx);
            document.querySelectorAll('a[data-type]').forEach(link => {
                const type = link.getAttribute('data-type');
                if (!type) return;
                const urlObj = new URL(link.href);
                link.href = `https://${type}${suffix}.pages.dev${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
            });
        }
    }
}