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


getUsage();
localStorage.getItem('darkMode') === 'enabled' && document.body.classList.add('dark-mode');
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

            if (!success) {
                throw new Error(`status ${status} - ${message}`);
            }

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
		renderCustomGroups();
		setInterval(updateCountdown, 1000);
		updateCountdown();
		updateLinks();
    } catch (error) {
        console.error('Panel initiation error:', error);
    }
}

async function getUsage() {
    try {
        const nocache = Date.now();
        const res = await fetch(`./panel/usage?nocache=${nocache}`, { cache: 'no-store' });
        const { success, status, message, body } = await res.json();

        if (!success) {
            throw new Error(`status ${status} - ${message}`);
        }

        const { total, worker } = body;
        const totalReq = document.getElementById('total-usage');
        totalReq.textContent = total.toLocaleString('en-US');
        totalReq.style.fontSize = 'larger';
        const totalPct = document.getElementById('total-pct');
        const totalPctVal = Math.ceil(Number(total) / 100000 * 100);
        totalPct.textContent = totalPctVal;
        if (totalPctVal > 80) totalPct.style.color = 'var(--color-icon-red)';

        const panelReq = document.getElementById('panel-usage');
        panelReq.textContent = worker.toLocaleString('en-US');
        panelReq.style.fontSize = 'larger';
        const panelPct = document.getElementById('panel-pct');
        const panelPctVal = Math.ceil(Number(worker) / 100000 * 100);
        panelPct.textContent = panelPctVal;
        if (panelPctVal > 80) panelPct.style.color = 'var(--color-icon-red)';
    } catch (error) {
        console.error('Failed to get usage from API:', error);
    }
}

async function checkVersion(panelVersion) {
    try {
        const res = await fetch('https://raw.githubusercontent.com/bia-pain-bache/BPB-Worker-Panel/refs/heads/main/package.json', {
            cache: 'no-store'
        });

        if (!res.ok) {
            throw new Error(`status ${res.status}`);
        }

        const pkg = await res.json();
        const latest = pkg.version;
        const updateAvailable = isNewerVersion(latest, panelVersion);
        if (updateAvailable) {
            globalThis.latestVersion = latest;
            const upgradeBtn = document.getElementById('updatePanel');
            upgradeBtn.disabled = false;
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

function renderPanel(proxySettings, tgSettings, subscriptions, clients) {
	const {
		securePath,
		ports,
		xrayUdpNoises,
		remoteSettings,
		customGroups,       // ✅ 新增
		linkIPs,            // ✅ 新增
		linkUrl             // ✅ 新增（可选）
	} = proxySettings;

	globalThis.customGroups = customGroups || [];
	renderCustomGroups();
	renderLinkIPs(linkIPs);
	
	const path = encodeURIComponent(securePath);
    if (path !== window.location.pathname.split('/')[1]) {
        setTimeout(() => {
            window.location.href = `../${path}/panel`;
        }, 1000);
    }

    const dohUrl = new URL(`./dns-query`, window.location.href);
    document.getElementById('doh').textContent = dohUrl.href;
    document.getElementById('fetchSettingsBtn').disabled = !remoteSettings;

    globalThis.customGroups = customGroups || [];
    renderCustomGroups();
    renderLinkIPs(linkIPs);
    
    selectElements.forEach(elm => elm.value = proxySettings[elm.id]);
    checkboxElements.forEach(elm => elm.checked = proxySettings[elm.id]);
    inputElements.forEach(elm => elm.value = proxySettings[elm.id] || '');
	textareaElements.forEach(elm => {
		const key = elm.id;
		const element = document.getElementById(key);

		// ✅ linkUrl 是 string，特殊处理，跳过数组逻辑
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
            tgForm.elements[key].value = tgSettings[key];
        }
    }
}

function hasFormDataChanged() {
    const formDataToObject = (formData) => Object.fromEntries(formData.entries());
    const configForm = document.getElementById('configForm');
    const currentFormData = new FormData(configForm);

    const initialFormDataObj = formDataToObject(globalThis.initialFormData);
    const currentFormDataObj = formDataToObject(currentFormData);

    return JSON.stringify(initialFormDataObj) !== JSON.stringify(currentFormDataObj);
}

function handleProxyFormChanges(force = false) {
    const applyButton = document.getElementById('applyButton');
    const isChanged = hasFormDataChanged();
    applyButton.disabled = force ? false : !isChanged;
}

function handleTgFormChanges(settings) {
    const userId = document.getElementById('telegramUserId');
    const token = document.getElementById('telegramBotToken');
    const setupBtn = document.getElementById('setup-telegram');
    const removeBtn = document.getElementById('remove-telegram');

    if (settings) {
        const { telegramUserId, telegramBotToken } = settings;
        removeBtn.disabled = !telegramUserId && !telegramBotToken;
        setupBtn.disabled = true;

        userId.value = telegramUserId;
        token.value = telegramBotToken;

        return;
    }

    setupBtn.disabled = !userId.value.trim() || !token.value.trim();
}

async function getIpDetails(ip) {
    try {
        const response = await fetch('./panel/my-ip', { method: 'POST', body: ip });
        const { success, status, message, body } = await response.json();

        if (!success) {
            throw new Error(`status ${status} - ${message}`);
        }

        return body;
    } catch (error) {
        console.error('Fetching IP error:', error)
    }
}

async function fetchIPInfo() {
    const icons = startWaiting(null, 'refresh-geo-location', '');

    const updateUI = (ip = '-', country = '-', countryCode = '-', city = '-', isp = '-', cfIP) => {
        const flag = countryCode !== '-' ? String.fromCodePoint(...[...countryCode].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '';
        const updateContent = (id, content) => document.getElementById(id).textContent = content;
        updateContent(cfIP ? 'cf-ip' : 'ip', ip);
        updateContent(cfIP ? 'cf-country' : 'country', `${flag} ${country}`);
        updateContent(cfIP ? 'cf-city' : 'city', city);
        updateContent(cfIP ? 'cf-isp' : 'isp', isp);
    };

    const nocache = Date.now();
    const othersPromise = fetch(`https://ipv4.geojs.io/v1/ip.json?nocache=${nocache}`, { cache: 'no-store' })
        .then(async res => {
            if (!res.ok) throw new Error(`Fetch Other targets IP failed.`);
            const { ip } = await res.json();
            const { country, countryCode, city, isp } = await getIpDetails(ip);
            updateUI(ip, country, countryCode, city, isp);
        });

    const cfPromise = fetch(`https://ipv4.icanhazip.com/?nocache=${nocache}`, { cache: 'no-store' })
        .then(async res => {
            if (!res.ok) throw new Error(`Fetch Cloudflare targets IP failed.`);
            const ip = await res.text();
            const { country, countryCode, city, isp } = await getIpDetails(ip.trim());
            updateUI(ip, country, countryCode, city, isp, true);
        });

    const results = await Promise.allSettled([othersPromise, cfPromise]);
    results.forEach(result => {
        if (result.status === 'rejected') console.error(result.reason);
    });

    stopWaiting(icons);
}

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
    if (!res.ok) {
        throw new Error(`status ${res.status}`);
    }

    const blob = await res.blob();

    return elm('img', {
        id: 'qr',
        className: 'qrcode',
        src: URL.createObjectURL(blob)
    });
}

function showQRCode(subUrl) {
    const url = new URL(subUrl);
    const modal = document.getElementById('qrModal');
    const close = modal.querySelector('.modal-close');
    const container = document.getElementById('qrcode-container');

    let qrcodeTitle = document.getElementById('qrcodeTitle');
    qrcodeTitle.textContent = decodeURIComponent(url.hash).replace('#', '');

    close.onclick = () => {
        modal.hidden = true;
        container.lastElementChild.remove();
        window.onclick = null;
    };

    window.onclick = (event) => {
        if (event.target == modal) {
            modal.hidden = true;
            container.lastElementChild.remove();
        }
    }

    generateQRCode(subUrl).then(qr => {
        container.appendChild(qr);
        modal.hidden = false;
    });
}

function copyToClipboard(url) {
    navigator.clipboard.writeText(url)
        .then(() => notify('info', 'Copied to clipboard', [url]))
        .catch(error => console.error('Failed to copy:', error));
}

function copyDoh() {
    const url = document.getElementById('doh').textContent;
    copyToClipboard(url);
}

async function dlUrl(subUrl) {
    const url = new URL(subUrl);
    window.location.href = url.protocol === 'sing-box:' ? url.searchParams.get('url') : subUrl;
}

async function exportFileSettings(event) {
    if (hasFormDataChanged()) {
        notify('error', 'Export settings', ['Please apply unsaved changes first.']);
        return;
    }

    const icons = startWaiting(event.target, '', 'refresh');
    const url = new URL('./sub/share-settings', window.location.href);
    window.location.href = url.href;
    stopWaiting(icons);
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
        const text = await file.text();
        const data = atob(text);
        const newSettings = JSON.parse(data);
        const currentSettings = validateSettings();
        const settings = { ...currentSettings, ...newSettings };

        renderPanel(settings);
        handleProxyFormChanges(true);

        notify('success', 'Import settings', [
            'Settings imported successfully!',
            'Please first REVIEW new settings and then apply, specially ROUTING settings.'
        ]);
    } catch (error) {
        console.error('Import settings error:', error);
        notify('error', 'Import settings', ['Failed to get settings from file.']);
    }
}

async function importRemoteSettings(event) {
    if (hasFormDataChanged()) {
        notify('error', 'Import settings', ['Please apply unsaved changes first.']);
        return;
    }

    const icons = startWaiting(event.target, '', 'refresh');
    const remote = document.getElementById('remoteSettings').value.trim();
    const currentSettings = validateSettings();

    try {
        const newSettings = await fetchSettings(remote);
        const settings = { ...currentSettings, ...newSettings };

        renderPanel(settings);
        handleProxyFormChanges(true);

        notify('success', 'Import settings', [
            'Settings imported successfully!',
            'Please first REVIEW new settings and then apply, specially ROUTING settings.'
        ]);
    } catch (error) {
        console.error('Import settings error:', error);
        notify('error', 'Import settings', ['Failed to get settings from remote.']);
    } finally {
        stopWaiting(icons);
    }
}

function shareSettings() {
    const url = new URL('./sub/share-settings', window.location.href);
    copyToClipboard(url);
}

async function fetchSettings(remoteUrl) {
    const url = new URL(remoteUrl);
    const remote = `${url.origin + url.pathname}?nocache=${Date.now()}`;

    const res = await fetch(remote, { cache: 'no-store' });
    if (!res.ok) {
        throw new Error(`status ${res.status}`);
    }

    const data = await res.text();
    return JSON.parse(atob(data));
}

async function renewWarpAccounts(btn) {
    const confirm = await notify('confirm', 'Renew Warp Accounts', ['Are you sure?'])
    if (!confirm) return;
    const icons = startWaiting(btn, '', '');

    try {
        const response = await fetch('./panel/update-warp', { method: 'POST', credentials: 'include' });
        const { success, status, message } = await response.json();

        if (!success) {
            notify('error', 'Renew Warp Accounts', ['An error occured, Please try again later.']);
            throw new Error(`status ${status} - ${message}`);
        }

        notify('success', 'Renew Warp Accounts', ['Warp accounts updated successfully!']);
    } catch (error) {
        console.error('Updating Warp configs error:', error)
        notify('error', 'Renew Warp Accounts', ['Failed to renew Warp accounts.']);
    } finally {
        stopWaiting(icons);
    }
}

async function handleRiskyRules(event) {
    if (event.target.checked) {
        const proceed = await notify('confirm', 'Geo asset files', [
            "v2ray users should set Geo Assets to Chocolate4U and download assets, otherwise configs won't connect.",
            'Proceed anyway?'
        ]);

        if (!proceed) {
            event.target.checked = false;
            return;
        }
    }
}

function handleFragmentMode() {
    const fragmentMode = document.getElementById('fragmentMode').value;
    const formDataObj = Object.fromEntries(globalThis.initialFormData.entries());
    const inputs = [
        'fragmentLengthMin',
        'fragmentLengthMax',
        'fragmentDelayMin',
        'fragmentDelayMax'
    ];

    const configs = {
        low: [100, 200, 1, 1],
        medium: [50, 100, 1, 5],
        high: [10, 20, 10, 20],
        severe: [1, 5, 1, 5],
        custom: inputs.map(id => formDataObj[id])
    };

    inputs.forEach((id, index) => {
        const elm = document.getElementById(id);
        elm.value = configs[fragmentMode][index];
        fragmentMode !== 'custom'
            ? elm.setAttribute('readonly', 'true')
            : elm.removeAttribute('readonly');
    });
}

async function resetSettings(btn) {
    const confirm = await notify(
        'confirm',
        'Reset panel settings',
        [
            'This will reset all settings except:',
            '+ VLESS UUID',
            '+ Trojan password',
            '+ Panel - Subscriptions path\n',
            'Are you sure?'
        ]
    );

    if (!confirm) return;
    const icons = startWaiting(btn, '', '', false);

    try {
        const res = await fetch('./panel/reset-settings', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });

        const { success, status, message, body } = await res.json();
        if (!success) {
            throw new Error(`status ${status} - ${message}`);
        }

        notify(
            'success',
            'Reset panel settings',
            ['Please update your subscriptions.']
        );

        renderPanel(body);
    } catch (error) {
        console.error('Reseting settings error:', error);
    } finally {
        stopWaiting(icons);
    }
}

function updateSettings(event, data) {
    event.preventDefault();
    event.stopPropagation();

    const validatedForm = validateSettings();
    if (!validatedForm) return false;
    const form = data ?? validatedForm;

    const icons = startWaiting(null, 'applyButton', 'refresh');

    fetch('./panel/update-settings', {
        method: 'PUT',
        body: JSON.stringify(form),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    })
        .then(res => res.json())
        .then(({ success, status, message, body: errors }) => {
            if (status === 401) {
                notify(
                    'error',
                    'Apply settings',
                    ['Session expired! Please login and try again.']
                );
                window.location.href = './login';
            }

            if (!success) {
                errors.forEach(error => {
                    notify('error', error.field, error.message);
                });
                throw new Error(`status ${status} - ${message}`);
            }

            notify(
                'success',
                'Apply settings',
                ['Please update your subscriptions.']
            );

            renderPanel(form);
        })
        .catch(error => console.error('Update settings error:', error))
        .finally(() => stopWaiting(icons));
}

function setupTelegramBot() {
    event.preventDefault();
    event.stopPropagation();

    const formData = new FormData(event.target);
    const form = Object.fromEntries(formData.entries());

    const setupBtn = document.getElementById('setup-telegram');
    const icons = startWaiting(setupBtn, '', 'refresh');

    fetch('./telegram/setup', {
        method: 'PUT',
        body: JSON.stringify(form),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    })
        .then(res => res.json())
        .then(({ success, status, message, body }) => {
            if (status === 401) {
                notify(
                    'error',
                    'Setup Telegram bot',
                    ['Session expired! Please login and try again.']
                );
                window.location.href = './login';
            }

            if (!success) {
                throw new Error(`status ${status} - ${message}`);
            }

            handleTgFormChanges(body);
            notify(
                'success',
                'Setup Telegram bot',
                ['Telegram bot is ready to use.']
            );
        })
        .catch(error => console.error('Setup Telegram bot error:', error))
        .finally(() => {
            stopWaiting(icons);
            setupBtn.disabled = true;
        });
}

function removeTelegramBot(btn) {
    const icons = startWaiting(btn, '', 'refresh');

    fetch('./telegram/remove', { method: 'POST', credentials: 'include' })
        .then(res => res.json())
        .then(({ success, status, message, body }) => {
            if (status === 401) {
                notify(
                    'error',
                    'Remove Telegram bot',
                    ['Session expired! Please login and try again.']
                );
                window.location.href = './login';
            }

            if (!success) {
                throw new Error(`status ${status} - ${message}`);
            }

            handleTgFormChanges(body);
            notify(
                'success',
                'Remove Telegram bot',
                ['Telegram bot removed successfully!']
            );
        })
        .catch(error => console.error('Remove Telegram bot error:', error))
        .finally(() => stopWaiting(icons));
}

function validateSettings() {
    const configForm = document.getElementById('configForm');
    const formData = new FormData(configForm);

    const fields = [
        'udpXrayNoiseMode',
        'udpXrayNoisePacket',
        'udpXrayNoiseDelayMin',
        'udpXrayNoiseDelayMax',
        'udpXrayNoiseCount'
    ].map(field => formData.getAll(field));

    const form = Object.fromEntries(formData.entries());
    const [modes, packets, delaysMin, delaysMax, counts] = fields;

    form.xrayUdpNoises = modes.map((mode, index) => ({
        type: mode,
        packet: packets[index],
        delay: `${delaysMin[index]}-${delaysMax[index]}`,
        count: counts[index]
    }));

    form.ports = [
        ...defaultHttpPorts,
        ...defaultHttpsPorts
    ].filter(port => formData.has(port.toString()));

    checkboxElements.forEach(elm => {
        form[elm.id] = formData.has(elm.id);
    });

    selectElements.forEach(elm => {
        let value = form[elm.id];
        if (value === 'true') value = true;
        if (value === 'false') value = false;
        form[elm.id] = value;
    });

    inputElements.forEach(elm => {
        if (typeof form[elm.id] === 'string') {
            form[elm.id] = form[elm.id].trim();
        }
    });

    numInputElements.forEach(elm => {
        form[elm.id] = Number(form[elm.id].trim());
    });

    textareaElements.forEach(elm => {
        const key = elm.id;
        const value = form[key];
        form[key] = value?.split('\n').map(val => val.trim()).filter(Boolean) || [];
    });
    
    form.customGroups = globalThis.customGroups || [];
    form.linkUrl = document.getElementById('linkUrl')?.value.trim() || '';
    return form;
}

function logout(event) {
    event.preventDefault();
    fetch('./panel/logout', { method: 'GET', credentials: 'same-origin' })
        .then(response => response.json())
        .then(({ success, status, message }) => {
            if (!success) {
                throw new Error(`status ${status} - ${message}`);
            }

            window.location.href = './login';
        })
        .catch(error => console.error('Logout error:', error));
}

function openResetPass(event) {
    const modal = document.getElementById('resetPassModal');
    const close = modal.querySelector('.modal-close');
    const showHides = modal.querySelectorAll('.show-hide');
    const title = modal.querySelector('.modal-title');
    const form = modal.querySelector('.config-form');
    const username = document.getElementById('usernameContainer');
    if (!event) {
        title.textContent = 'Set Password';
        username.style.display = 'flex';
        username.setAttribute('required', 'true');
    }

    close.onclick = () => modal.hidden = true;
    form.onsubmit = resetPassword;
    showHides.forEach(elm => {
        elm.onclick = () => {
            const input = elm.previousElementSibling;
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            elm.textContent = isPassword ? 'visibility' : 'visibility_off';
        }
    });

    modal.hidden = false;
}

function resetPassword(event) {
    event.preventDefault();
    const username = document.getElementById('username').value.trim().toLowerCase();
    const passwordError = document.getElementById('passwordError');
    const password = document.getElementById('newPassword').value.trim();
    const confirmPassword = document.getElementById('confirmPassword').value.trim();

    if (password !== confirmPassword) {
        passwordError.textContent = 'Passwords do not match';
        return false;
    }

    const valid = /^(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);
    if (!valid) {
        passwordError.textContent = 'Must contain at least one capital letter, one number, and be at least 8 characters long.';
        return false;
    }

    fetch('./panel/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        credentials: 'same-origin',
        body: JSON.stringify({
            username,
            password
        })
    })
        .then(response => response.json())
        .then(({ success, status, message }) => {
            if (!success) {
                passwordError.textContent = message;
                throw new Error(`status ${status} - ${message}`);
            }

            notify('success', 'Reset password', ['Password changed successfully!']);
            window.location.href = './login';
        })
        .catch(error => console.error('Reset password error:', error));
}

function genNoisePacket(mode, packet) {
    switch (mode.value) {
        case 'base64':
            packet.value = randBase64(32, 64);
            break;
        case 'rand':
            packet.value = '50-100';
            break;
        case 'hex':
            packet.value = randHex(32, 64);
            break;
        case 'array':
            packet.value = randArray(32, 64);
            break;
        case 'str': {
            const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            packet.value = randString(charset, 32, 64);
        }
    }

    handleProxyFormChanges();
}

function randUUID() {
    const uuid = document.getElementById('vlUUID');
    uuid.value = crypto.randomUUID();
    handleProxyFormChanges();
}

function randString(charset, minLen, maxLen) {
    return [...randBytes(minLen, maxLen)]
        .map(byte => charset[byte % charset.length])
        .join('');
}

function randArray(minLen, maxLen) {
    const length = Math.floor(Math.random() * (maxLen - minLen + 1)) + minLen;
    const array = Array.from({ length }, () => Math.floor(Math.random() * 256));
    const field = array.map(String).join(',');

    return field;
}

function randBytes(minBytes, maxBytes) {
    const bytes = Math.floor(Math.random() * (maxBytes - minBytes + 1)) + minBytes;
    const array = new Uint8Array(bytes);
    crypto.getRandomValues(array);

    return array;
}

function randHex(minBytes, maxBytes) {
    return [...randBytes(minBytes, maxBytes)]
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function randBase64(minBytes, maxBytes) {
    return btoa(String.fromCharCode(...randBytes(minBytes, maxBytes)));
}

function randPassword() {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@$&*_-+;:,.';
    const trPass = document.getElementById('trPass');
    trPass.value = randString(charset, 16, 32);
    handleProxyFormChanges();
}

function randPath() {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const securePath = document.getElementById('securePath');
    securePath.value = randString(charset, 16, 32);
    handleProxyFormChanges();
}

async function updatePanel(btn) {
    const confirm = await notify('confirm', 'Update BPB Panel', [
        `BPB Panel verseion ${globalThis.latestVersion} is now available!`,
        `Please read <a href='https://github.com/bia-pain-bache/BPB-Worker-Panel/releases/latest' target='_blank' rel='noopener noreferrer'>Release notes</a> carefully before updating.`,
        'Are you sure?'
    ]);

    if (!confirm) return;
    const icons = startWaiting(btn, '', 'refresh');

    fetch('./panel/update-panel', { method: 'POST' })
        .then(res => res.json())
        .then(({ success, status, message }) => {
            if (!success) throw new Error(`status ${status} - ${message}`);
            notify('success', 'Update panel', ['Your panel upgraded successfully!']);
            setTimeout(() => {
                location.reload();
            }, 3000);
        })
        .catch(error => {
            notify('error', 'Update panel', ['Failed to update your BPB Panel, please try again.']);
            console.error('Update panel error:', error)
        })
        .finally(() => stopWaiting(icons));
}

async function deletePanel(btn) {
    const confirm = await notify('confirm', 'Delete BPB Panel', [
        'This will permanently delete your panel from your Cloudflare account',
        'Are you sure?'
    ]);

    if (!confirm) return;
    const icons = startWaiting(btn, '', 'refresh');

    fetch('./panel/delete-panel', { method: 'POST' })
        .then(res => res.json())
        .then(({ success, status, message }) => {
            if (!success) throw new Error(`status ${status} - ${message}`);
            notify('success', 'Delete panel', ['Your panel deleted successfully!']);
        })
        .catch(error => {
            notify('error', 'Delete panel', ['Failed to delete your BPB Panel, please try again.']);
            console.error('Delete panel error:', error)
        })
        .finally(() => stopWaiting(icons));
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
        const isConfirm = type === 'confirm';

        icon.textContent = isOk ? 'check_circle' : isConfirm ? 'help' : 'error';
        icon.style.color = isOk ? 'var(--color-icon-green)' : 'var(--color-icon-red)';

        const okBtn = modal.querySelector('.message-ok-btn');
        const cancelBtn = modal.querySelector('.message-cancel-btn');
        const closeBtn = modal.querySelector('.modal-close');

        const handle = (value) => {
            modal.remove();
            resolve(value);
        };

        if (type === 'confirm') {
            cancelBtn.onclick = () => handle(false);
        } else {
            cancelBtn.style.display = 'none';
        }

        if (type === 'info') {
            okBtn.style.display = 'none';
        } else {
            okBtn.onclick = () => handle(true);
        }

        closeBtn.onclick = () => handle(false)
        document.body.appendChild(fragment);

        if (type === 'info') {
            setTimeout(() => {
                modal.remove();
                resolve(null);
            }, 1000);

            return;
        }
    });
}

function startWaiting(button, id, customIcon, cw = true) {
    document.body.classList.add('is-loading');
    const btn = button ?? document.getElementById(id);
    const icon = btn.querySelector('span');
    const initIcon = icon.textContent;
    if (customIcon) icon.textContent = customIcon;
    icon.classList.add(`${cw ? 'cw' : 'ccw'}-spinning`);
    return { icon, initIcon };
}

function stopWaiting(icons) {
    document.body.classList.remove('is-loading');
    const { icon, initIcon } = icons;
    icon.classList.remove('cw-spinning');
    icon.classList.remove('ccw-spinning');
    if (initIcon !== icon.textContent) icon.textContent = initIcon;
}

function elm(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...[].concat(children));
    return node;
}

const createIcon = (text) => elm('span', {
    className: 'material-symbols-rounded',
    textContent: text
});

function createFormControl(labelText, action) {
    const label = elm('span', { textContent: labelText }, action ? createIcon('refresh') : []);
    const control = elm('div', { className: 'form-control' }, [label, elm('div')]);

    return control;
}

async function deleteNoise(event) {
    const confirm = await notify('confirm', 'Delete UDP noise', ['Are you sure?']);
    if (!confirm) return;

    event.target.closest('.inner-container').remove();
    handleProxyFormChanges();
}

function addNoise(isManual, noiseIndex, udpNoise) {
    const index = noiseIndex
        ? noiseIndex
        : document.getElementById('noises').childElementCount;

    const noise = udpNoise || {
        type: 'rand',
        packet: '50-100',
        delay: '1-5',
        count: 5
    };

    const heading = elm('h4', { textContent: `Noise ${index + 1}` });
    const headerDiv = elm('div', { className: 'header-container' }, heading);

    if (index !== 0) {
        const deleteBtn = elm('button', {
            type: 'button',
            className: 'delete-noise',
            onclick: deleteNoise
        }, createIcon('delete'));
        headerDiv.appendChild(deleteBtn);
    }

    const modeOptions = [
        ['base64', 'Base64'],
        ['rand', 'Random'],
        ['str', 'String'],
        ['hex', 'Hex'],
        ['array', 'Array']
    ].map(([value, label]) => elm('option', { value, textContent: label, selected: noise.type === value }));

    const modeSelect = elm('select', { name: 'udpXrayNoiseMode' }, modeOptions);
    const modeControl = createFormControl('Mode');

    const selectWrapper = modeControl.querySelector('div');
    selectWrapper.className = 'select-wrapper';
    selectWrapper.append(modeSelect, createIcon('keyboard_arrow_down'))

    const packetInput = elm('input', { type: 'text', name: 'udpXrayNoisePacket', value: noise.packet });
    const packetControl = createFormControl('Packet', true);
    packetControl.querySelector('div').appendChild(packetInput);
    const generateBtn = packetControl.querySelector('.material-symbols-rounded');

    modeSelect.onchange = generateBtn.onclick = () => genNoisePacket(modeSelect, packetInput);

    const countInput = elm('input', {
        type: 'number', name: 'udpXrayNoiseCount', value: String(noise.count), min: '1', required: true
    });
    const countControl = createFormControl('Count');
    countControl.querySelector('div').appendChild(countInput);

    const [delayMin, delayMax] = noise.delay.split('-');
    const delayMinInput = elm('input', { type: 'number', name: 'udpXrayNoiseDelayMin', value: delayMin, min: '1', required: true });
    const delayMaxInput = elm('input', { type: 'number', name: 'udpXrayNoiseDelayMax', value: delayMax, min: '1', required: true });
    const minMaxDiv = elm('div', { className: 'min-max' }, [delayMinInput, elm('span', { textContent: ' - ' }), delayMaxInput]);
    const delayControl = createFormControl('Delay');
    delayControl.querySelector('div').appendChild(minMaxDiv);

    const section = elm('div', { className: 'section' }, [modeControl, packetControl, countControl, delayControl]);
    const container = elm('div', { className: 'inner-container' }, [headerDiv, section]);

    document.getElementById('noises').append(container);
    if (isManual) handleProxyFormChanges(true);
}

function renderPorts(ports) {
    let noneTlsPortsBlock = document.createDocumentFragment();
    let tlsPortsBlock = document.createDocumentFragment();

    const totalPorts = [
        ...(window.origin.includes('workers.dev') ? defaultHttpPorts : []),
        ...defaultHttpsPorts
    ];

    totalPorts.forEach(port => {
        const isChecked = ports.includes(port);
        const isHttpsPort = defaultHttpsPorts.includes(port);

        const checkbox = elm('input', {
            type: 'checkbox',
            name: String(port),
            value: 'true',
            checked: isChecked
        });

        const label = elm('span', { textContent: String(port) });
        const wrapper = elm('div', { className: 'checkbox-wrapper' }, [checkbox, label]);

        if (isHttpsPort) {
            tlsPortsBlock.appendChild(wrapper);
        } else {
            noneTlsPortsBlock.appendChild(wrapper);
        }
    });

    const tlsContainer = document.getElementById('tls-ports');
    tlsContainer.innerHTML = '';
    tlsContainer.appendChild(tlsPortsBlock);

    const nonTlsContainer = document.getElementById('non-tls-ports');
    if (noneTlsPortsBlock.childElementCount > 0) {
        nonTlsContainer.innerHTML = '';
        nonTlsContainer.appendChild(noneTlsPortsBlock);
        document.getElementById('none-tls').style.display = 'flex';
    }
}

function renderNoises(xrayUdpNoises) {
    document.getElementById('noises').innerHTML = '';
    xrayUdpNoises.forEach((noise, index) => {
        addNoise(false, index, noise);
    });
}

function renderSubscriptions(subscriptions) {
    if (!subscriptions) return;
    for (const [type, { label, categories }] of Object.entries(subscriptions)) {
        const help = elm('a', {
            className: 'help-icon',
            href: `https://bia-pain-bache.github.io/BPB-Worker-Panel/usage/${type}/`,
            target: '_blank',
            title: 'Help'
        }, createIcon('info'));

        const header = elm('h3', { textContent: label });
        const summary = elm('summary', {}, header);
        const section = elm('details', {}, summary);
        const table = elm('table', {}, categories.map(({ core, clients }) => {
            const clientSection = elm('td', {}, clients.map(client => {
                const icon = createIcon('verified');
                const title = elm('span', { textContent: client });
                const wrapper = elm('div', {}, [icon, title]);
                return wrapper;
            }));

            const url = generateSubUrl(type, core, label);
            const ctaSection = elm('td');

            const wgCore = ['wireguard', 'amnezia'].includes(core);
			if (!wgCore) {
				const qrBtn = elm('button', { title: 'QR', onclick: async () => {
					const useLink = await showSubTypeModal();
					if (useLink === null) return;
					showQRCode(generateSubUrl(type, core, label, useLink));
				}}, createIcon('qr_code'));
				
				const copyBtn = elm('button', { title: 'Copy', onclick: async () => {
					const useLink = await showSubTypeModal();
					if (useLink === null) return;
					copyToClipboard(generateSubUrl(type, core, label, useLink));
				}}, createIcon('content_copy'));
				ctaSection.append(qrBtn, copyBtn);
			}

			if (type !== 'raw') {
				const dlBtn = elm('button', { title: 'Download', onclick: async () => {
					const useLink = await showSubTypeModal();
					if (useLink === null) return;
					dlUrl(generateSubUrl(type, core, label, useLink));
				}}, createIcon('download'));
				ctaSection.appendChild(dlBtn);
			}

            return elm('tr', {}, [clientSection, ctaSection]);
        }));

        const container = elm('div', { className: 'table-container' }, table);
        section.appendChild(container);
        const item = elm('div', { className: 'accordion-item' }, [section, help]);
        document.getElementById('subscriptions').appendChild(item);
    };
}

function renderClients(clients) {
    if (!clients) return;
    clients.forEach(client => {
        const name = elm('td', { scope: 'col', textContent: client.name });
        const minVer = elm('td', { scope: 'col', textContent: client.minVer });

        const source = elm('span', { textContent: client.source });
        const dlBtn = elm('a', {
            href: atob(client.b64Url),
            target: '_blank',
            rel: 'noopener noreferrer'
        }, createIcon('download'));
        const download = elm('td', {}, [source, dlBtn]);

        const row = elm('tr', {}, [name, minVer, download])

        document.getElementById('supported-clients').appendChild(row);
    });
}

// ============ Cloudflare 用量 ============
async function fetchcloudflareInfo() {
    const usageRes = await fetch('./panel/cloudflare-usage', { cache: 'no-store' });
    const usageData = await usageRes.json();
    const kvRes = await fetch('./panel/kv-usage', { cache: 'no-store' });
    const kvData = await kvRes.json();
    updateCloudflareUI(usageData, kvData);
}

function updateCloudflareUI(usageData, kvData) {
    const usageEmoji = document.getElementById('usage-status-emoji');
    const kvEmoji = document.getElementById('kv-status-emoji');
    if (usageEmoji) usageEmoji.textContent = usageData.success ? '🟢' : '🔴';
    if (kvEmoji) kvEmoji.textContent = kvData.success ? '🟢' : '🔴';

    if (usageData.success && usageData.body) {
        const total = usageData.body.total || 0;
        document.getElementById('cf-request-used').textContent = total.toLocaleString();
        document.getElementById('cf-request-percent').textContent = (usageData.body.percentage || '0') + '%';
    }

    if (kvData.success && kvData.body) {
        document.getElementById('cf-kv-read-used').textContent = (kvData.body.readTotal || 0).toLocaleString();
        document.getElementById('cf-kv-read-percent').textContent = (kvData.body.readPercentage || '0') + '%';
        document.getElementById('cf-kv-write-used').textContent = (kvData.body.writeTotal || 0).toLocaleString();
        document.getElementById('cf-kv-write-percent').textContent = (kvData.body.writePercentage || '0') + '%';

        let html = '';
        if (kvData.body.details?.length) {
            html = kvData.body.details.map(ns =>
                `<div style="padding:5px 0;"><strong>${ns.namespaceName}</strong><br>
                 读: ${ns.read || 0} | 写: ${ns.write || 0} | 删: ${ns.delete || 0} | 列: ${ns.list || 0}</div>`
            ).join('');
        } else {
            html = '暂无数据';
        }
        document.getElementById('cf-kv-details').innerHTML = html;
    }
}

// ============ Cloudflare 配置 ============
async function loadCloudflareConfig() {
    const res = await fetch('./panel/cloudflare-config');
    const data = await res.json();
    if (data.success && data.body) {
        document.getElementById('cfAccountId').value = data.body.accountId || '';
        document.getElementById('cfApiToken').value = data.body.apiToken || '';
        document.getElementById('cfEmail').value = data.body.email || '';
        document.getElementById('cfGlobalApiKey').value = data.body.globalApiKey || '';
        document.getElementById('cfQueryUrl').value = data.body.queryUrl || '';
    }
}

async function saveCloudflareConfig() {
    const config = {
        accountId: document.getElementById('cfAccountId').value.trim(),
        apiToken: document.getElementById('cfApiToken').value.trim(),
        email: document.getElementById('cfEmail').value.trim(),
        globalApiKey: document.getElementById('cfGlobalApiKey').value.trim(),
        queryUrl: document.getElementById('cfQueryUrl').value.trim()
    };
    if (!config.queryUrl && (!config.accountId || (!config.apiToken && (!config.email || !config.globalApiKey)))) {
        return notify('error', 'Cloudflare Config', ['请填写 Account ID + API Token 或 Email + Global API Key，或提供 Query URL']);
    }
    const res = await fetch('./panel/cloudflare-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
    });
    const data = await res.json();
    if (data.success) {
        notify('success', 'Cloudflare Config', ['配置已保存']);
        setTimeout(fetchcloudflareInfo, 500);
    } else {
        notify('error', 'Cloudflare Config', [data.message || '保存失败']);
    }
}

async function clearCloudflareConfig() {
    const ok = await notify('confirm', 'Cloudflare Config', ['确定清除配置？']);
    if (!ok) return;
    const res = await fetch('./panel/cloudflare-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: '', apiToken: '', email: '', globalApiKey: '', queryUrl: '' })
    });
    const data = await res.json();
    if (data.success) {
        ['cfAccountId', 'cfApiToken', 'cfEmail', 'cfGlobalApiKey', 'cfQueryUrl'].forEach(id => {
            document.getElementById(id).value = '';
        });
        notify('success', 'Cloudflare Config', ['配置已清除']);
    }
}

// ============ 背景 ============
async function loadBackgroundOnInit() {
    const res = await fetch('./panel/background-config');
    const data = await res.json();
    if (data.success && data.body) {
        document.getElementById('bgImageInput').value = data.body.image || '';
        document.getElementById('bgPositionSelect').value = data.body.position || 'left';
        document.getElementById('bgOpacityInput').value = data.body.opacity || 0.9;
        globalThis.currentBgImage = data.body.image || '';
    }
}

async function saveBackground() {
    const image = document.getElementById('bgImageInput').value.trim();
    const position = document.getElementById('bgPositionSelect').value;
    const opacity = parseFloat(document.getElementById('bgOpacityInput').value);
    if (!image) return notify('error', '背景', ['请输入背景图地址']);
    if (isNaN(opacity) || opacity < 0 || opacity > 1) return notify('error', '背景', ['透明度必须在 0 ~ 1 之间']);
    const res = await fetch('./panel/background-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, position, opacity })
    });
    const data = await res.json();
    if (data.success) {
        applyBackgroundToPage(image, position, opacity);
        notify('success', '背景', ['已保存']);
    } else {
        notify('error', '背景', [data.message || '保存失败']);
    }
}

async function resetBackground() {
    const ok = await notify('confirm', '背景', ['确定重置为默认？']);
    if (!ok) return;
    const res = await fetch('./panel/reset-background', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
        const bg = data.body;
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
    
    // ✅ 应用到 .container-big 的透明度
    document.querySelectorAll('.container-big').forEach(el => {
        el.style.setProperty('opacity', opacity, 'important');
    });
}

function convertBgImageToBase64() {
    const file = document.getElementById('bgImageFile').files[0];
    if (!file) return;
    if (!file.type.match('image.*')) return notify('error', 'Base64', ['请选择图片文件']);
    if (file.size > 0.7 * 1024 * 1024) return notify('error', 'Base64', ['图片不能超过 700KB']);
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('bgPreviewImg').src = e.target.result;
        document.getElementById('bgImagePreview').style.display = 'block';
        document.getElementById('bgBase64Result').value = e.target.result;
    };
    reader.readAsDataURL(file);
}

function copyBgBase64() {
    const v = document.getElementById('bgBase64Result').value;
    if (!v) return notify('error', 'Base64', ['没有可复制的内容']);
    navigator.clipboard.writeText(v).then(() => notify('info', 'Base64', ['已复制']));
}

function clearBgBase64() {
    document.getElementById('bgImageFile').value = '';
    document.getElementById('bgImagePreview').style.display = 'none';
    document.getElementById('bgBase64Result').value = '';
}

function applyBgBase64AsBackground() {
    const v = document.getElementById('bgBase64Result').value;
    if (!v) return notify('error', 'Base64', ['请先生成 Base64']);
    document.getElementById('bgImageInput').value = v;
    notify('info', 'Base64', ['已填入背景输入框，点击"保存"应用']);
}

document.getElementById('bgImageFile')?.addEventListener('change', convertBgImageToBase64);

// ============ Link IPs ============
function renderLinkIPs(linkIPs) {
    const display = document.getElementById('linkIPsDisplay');
    if (!display) return;
    display.textContent = linkIPs?.length ? linkIPs.join(', ') : '暂无链接节点';
}

// ============ 订阅来源选择 ============
function showSubTypeModal() {
    return new Promise(resolve => {
        const modal = document.getElementById('subTypeModal');
        modal.hidden = false;
        document.getElementById('subTypeLink').onclick = () => { modal.hidden = true; resolve(true); };
        document.getElementById('subTypeClean').onclick = () => { modal.hidden = true; resolve(false); };
        modal.querySelector('.modal-close').onclick = () => { modal.hidden = true; resolve(null); };
    });
}

function closeSubTypeModal() {
    document.getElementById('subTypeModal').hidden = true;
}

// ============ 自定义分组 ============
function renderCustomGroups() {
    const list = document.getElementById('customGroupList');
    if (!list) return;
    const groups = globalThis.customGroups || [];
    if (groups.length === 0) {
        list.innerHTML = '<div style="color:var(--hr-text-color);padding:8px;text-align:center;">暂无自定义分组</div>';
    } else {
        list.innerHTML = groups.map((g, i) => `
            <div class="custom-group-item">
                <input type="checkbox" class="group-checkbox" data-index="${i}">
                <span class="group-info"><strong>${escapeHtml(g.name)}</strong> — ${escapeHtml(g.url)}</span>
                <button type="button" class="delete-noise" onclick="removeCustomGroup(${i})">✕</button>
            </div>
        `).join('');
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function addCustomGroup() {
    const name = document.getElementById('newGroupName').value.trim();
    const url = document.getElementById('newGroupUrl').value.trim();
    if (!name || !url) return notify('error', 'Custom Groups', ['请填写完整']);
    if (!globalThis.customGroups) globalThis.customGroups = [];
    globalThis.customGroups.push({ name, url });
    document.getElementById('newGroupName').value = '';
    document.getElementById('newGroupUrl').value = '';
    renderCustomGroups();
    handleProxyFormChanges(true);
}

function removeCustomGroup(index) {
    globalThis.customGroups.splice(index, 1);
    renderCustomGroups();
    handleProxyFormChanges(true);
}

function moveSelected(direction) {
    const checks = document.querySelectorAll('.group-checkbox:checked');
    if (!checks.length) return notify('error', 'Custom Groups', ['请先勾选']);
    const indices = Array.from(checks).map(cb => parseInt(cb.dataset.index)).sort((a, b) => a - b);
    const groups = globalThis.customGroups;
    const items = indices.map(i => groups[i]);
    const firstIdx = indices[0];
    const lastIdx = indices[indices.length - 1];
    const count = indices.length;
    [...indices].sort((a, b) => b - a).forEach(i => groups.splice(i, 1));
    let pos;
    if (direction === 'top') pos = 0;
    else if (direction === 'bottom') pos = groups.length;
    else if (direction === 'up') pos = Math.max(0, firstIdx - 1);
    else pos = Math.min(groups.length, lastIdx - count + 2);
    if (direction === 'bottom') groups.push(...items);
    else groups.splice(pos, 0, ...items);
    renderCustomGroups();
    handleProxyFormChanges(true);
}

// ============ 暗色模式 ============
async function darkModeToggle() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', isDark ? 'enabled' : 'disabled');
    await fetch('./panel/dark-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ darkMode: isDark })
    });
}

// ============ UTC 倒计时 ============
function updateCountdown() {
    const now = new Date();
    const remaining = 24 * 3600 * 1000 - (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()) * 1000;
    const el = document.getElementById('resetCountdown');
    if (!el) return;
    const fmt = (n) => String(n).padStart(2, '0');
    el.textContent = `${fmt(Math.floor(remaining / 3600000))}:${fmt(Math.floor((remaining % 3600000) / 60000))}:${fmt(Math.floor((remaining % 60000) / 1000))}`;
}

// ============ 动态域名替换 ============
function updateLinks() {
    const hostname = window.location.hostname;
    if (hostname.includes('pages.dev') && hostname.includes('-')) {
        const dashIndex = hostname.indexOf('-');
        const dotIndex = hostname.indexOf('.');
        if (dashIndex !== -1 && dotIndex !== -1 && dashIndex < dotIndex) {
            const suffix = hostname.substring(dashIndex, dotIndex);
            document.querySelectorAll('a[data-type]').forEach(link => {
                const type = link.getAttribute('data-type');
                if (!type) return;
                const urlObj = new URL(link.href);
                link.href = `https://${type}${suffix}.pages.dev${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
            });
        }
    }
}