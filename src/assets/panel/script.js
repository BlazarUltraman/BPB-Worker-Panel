localStorage.getItem('darkMode') === 'enabled' && document.body.classList.add('dark-mode');
const form = document.getElementById("configForm");
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
].map(query => form.querySelectorAll(query));

const defaultHttpsPorts = [443, 8443, 2053, 2083, 2087, 2096];
const defaultHttpPorts = [80, 8080, 8880, 2052, 2082, 2086, 2095];

fetch('/panel/settings')
    .then(async response => response.json())
    .then(({ success, status, message, body }) => {

        if (status === 401 && !body.isPassSet) {
            const closeBtn = document.querySelector(".close");
            openResetPass();
            closeBtn.style.display = 'none';
        }

        if (!success) {
            throw new Error(`status ${status} - ${message}`);
        }

        const { subPath, proxySettings } = body;
        globalThis.subPath = encodeURIComponent(subPath);
        initiatePanel(proxySettings);
    })
    .catch(error => console.error("Data query error:", error.message || error))
    .finally(() => {
        window.onclick = (event) => {
            const qrModal = document.getElementById('qrModal');
            const qrcodeContainer = document.getElementById('qrcode-container');

            if (event.target == qrModal) {
                qrModal.style.display = "none";
                qrcodeContainer.lastElementChild.remove();
            }
        }

        document.querySelectorAll(".toggle-password").forEach(toggle => {
            toggle.addEventListener("click", function () {
                const input = this.previousElementSibling;
                const isPassword = input.type === "password";
                input.type = isPassword ? "text" : "password";
                this.textContent = isPassword ? "visibility" : "visibility_off";
            });
        });
    });

function initiatePanel(proxySettings) {
    const {
        VLConfigs,
        TRConfigs,
        ports,
        xrayUdpNoises
    } = proxySettings;

    Object.assign(globalThis, {
        activeProtocols: VLConfigs + TRConfigs,
        activeTlsPorts: ports.filter(port => defaultHttpsPorts.includes(port)),
        xrayNoiseCount: xrayUdpNoises.length,
    });

    populatePanel(proxySettings);
    renderPortsBlock(ports.map(Number));
    renderUdpNoiseBlock(xrayUdpNoises);
    initiateForm();
    fetchIPInfo();
    // 最后添加
    loadBackgroundOnInit();
    loadCloudflareConfig();
    fetchcloudflareInfo();
}

function populatePanel(proxySettings) {
    selectElements.forEach(elm => elm.value = proxySettings[elm.id]);
    checkboxElements.forEach(elm => elm.checked = proxySettings[elm.id]);
    inputElements.forEach(elm => elm.value = proxySettings[elm.id] || "");
    textareaElements.forEach(elm => {
        const key = elm.id;
        const element = document.getElementById(key);
        const value = proxySettings[key]?.join('\r\n');
        const rowsCount = proxySettings[key].length;
        element.style.height = 'auto';
        if (rowsCount) element.rows = rowsCount;
        element.value = value;
    });
}

function initiateForm() {
    const configForm = document.getElementById('configForm');
    globalThis.initialFormData = new FormData(configForm);
    enableApplyButton();

    configForm.addEventListener('input', enableApplyButton);
    configForm.addEventListener('change', enableApplyButton);

    const textareas = document.querySelectorAll("textarea");
    textareas.forEach(textarea => {
        textarea.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = `${this.scrollHeight}px`;
        });
    });

    // ----- 新增代码开始 -----
    const cleanIPsInput = document.getElementById('cleanIPs');
    if (cleanIPsInput) {
        cleanIPsInput.addEventListener('blur', function() {
            let value = this.value;
            if (value.includes(',') || value.includes('，')) {
                value = value.replace(/[,，]/g, '\n');
                value = value.split('\n')
                    .map(line => line.trim())
                    .filter(Boolean)
                    .join('\n');
                this.value = value;
                this.dispatchEvent(new Event('input', { bubbles: true }));
                this.style.height = 'auto';
                this.style.height = `${this.scrollHeight}px`;
            }
        });
    }
    // ----- 新增代码结束 -----
    
    // ----- Base64图片自动转换 -----
    const bgFileInput = document.getElementById('bgImageFile');
    if (bgFileInput) {
        bgFileInput.addEventListener('change', convertBgImageToBase64);
    }
    // ----- 结束 -----

    handleFragmentMode();
}

function hasFormDataChanged() {
    const formDataToObject = (formData) => Object.fromEntries(formData.entries());
    const configForm = document.getElementById('configForm');
    const currentFormData = new FormData(configForm);

    const initialFormDataObj = formDataToObject(globalThis.initialFormData);
    const currentFormDataObj = formDataToObject(currentFormData);

    return JSON.stringify(initialFormDataObj) !== JSON.stringify(currentFormDataObj);
}

function enableApplyButton() {
    const applyButton = document.getElementById('applyButton');
    const isChanged = hasFormDataChanged();
    applyButton.disabled = !isChanged;
    applyButton.classList.toggle('disabled', !isChanged);
}

function openResetPass() {
    const resetPassModal = document.getElementById('resetPassModal');
    resetPassModal.style.display = "block";
    document.body.style.overflow = "hidden";
}

function closeResetPass() {
    const resetPassModal = document.getElementById('resetPassModal');
    resetPassModal.style.display = "none";
    document.body.style.overflow = "";
}

function closeQR() {
    const qrModal = document.getElementById('qrModal');
    const qrcodeContainer = document.getElementById('qrcode-container');
    qrModal.style.display = "none";
    qrcodeContainer.lastElementChild.remove();
}

function darkModeToggle() {
    const isDarkMode = document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', isDarkMode ? 'enabled' : 'disabled');
}

async function getIpDetails(ip) {
    try {
        const response = await fetch('/panel/my-ip', { method: 'POST', body: ip });
        const { success, status, message, body } = await response.json();

        if (!success) {
            throw new Error(`status ${status} - ${message}`);
        }

        return body;
    } catch (error) {
        console.error("Fetching IP error:", error.message || error)
    }
}

async function fetchIPInfo() {
    const refreshIcon = document.getElementById("refresh-geo-location").querySelector('i');
    refreshIcon.classList.add('fa-spin');
    const updateUI = (ip = '-', country = '-', countryCode = '-', city = '-', isp = '-', cfIP) => {
        const flag = countryCode !== '-' ? String.fromCodePoint(...[...countryCode].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '';
        const updateContent = (id, content) => document.getElementById(id).textContent = content;
        updateContent(cfIP ? 'cf-ip' : 'ip', ip);
        updateContent(cfIP ? 'cf-country' : 'country', `${country} ${flag}`);
        updateContent(cfIP ? 'cf-city' : 'city', city);
        updateContent(cfIP ? 'cf-isp' : 'isp', isp);
    };

    try {
        const response = await fetch('https://ipwho.is/' + '?nocache=' + Date.now(), { cache: "no-store" });
        const { success, ip, message } = await response.json();

        if (!success) {
            throw new Error(`Fetch Other targets IP failed at ${response.url} - ${message}`);
        }

        const { country, countryCode, city, isp } = await getIpDetails(ip);
        updateUI(ip, country, countryCode, city, isp);
        refreshIcon.classList.remove('fa-spin');
    } catch (error) {
        console.error("Fetching IP error:", error.message || error)
    }

    try {
        const response = await fetch('https://ipv4.icanhazip.com/?nocache=' + Date.now(), { cache: "no-store" });

        if (!response.ok) {
            const errorMessage = await response.text();
            throw new Error(`Fetch Cloudflare targets IP failed with status ${response.status} at ${response.url} - ${errorMessage}`);
        }

        const ip = await response.text();
        const { country, countryCode, city, isp } = await getIpDetails(ip);
        updateUI(ip, country, countryCode, city, isp, true);
        refreshIcon.classList.remove('fa-spin');
    } catch (error) {
        console.error("Fetching IP error:", error.message || error)
    }
}

function downloadWarpConfigs(isAmnezia) {
    const client = isAmnezia ? "?app=amnezia" : "";
    window.location.href = "/panel/get-warp-configs" + client;
}

function generateSubUrl(path, app, tag, singboxType) {
    const url = new URL(window.location.href);
    url.pathname = `/sub/${path}/${globalThis.subPath}`;
    app && url.searchParams.append('app', app);

    if (tag) {
        url.hash = `💦 BPB ${tag}`;
    }

    return singboxType
        ? `sing-box://import-remote-profile?url=${url.href}`
        : url.href;
}

function subURL(path, app, tag, singboxType) {
    const url = generateSubUrl(path, app, tag, singboxType);
    copyToClipboard(url);
}

async function dlURL(path, app) {
    const url = generateSubUrl(path, app);

    try {
        const response = await fetch(url);
        const data = await response.text();

        if (!response.ok) {
            throw new Error(`status ${response.status} at ${response.url} - ${data}`);
        }

        downloadJSON(data, "config.json");
    } catch (error) {
        console.error("Download error:", error.message || error);
    }
}

function downloadJSON(data, fileName) {
    const blob = new Blob([data], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function exportSettings() {
    const form = validateSettings();
    const data = JSON.stringify(form, null, 4);
    const encodedData = btoa(data);
    downloadJSON(encodedData, `BPB-settings.dat`);
}

function importSettings() {
    const input = document.getElementById('fileInput');
    input.value = '';
    input.click();
}

async function uploadSettings(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const data = atob(text);
        const settings = JSON.parse(data);
        updateSettings(event, settings);
        initiatePanel(settings);
    } catch (err) {
        console.error('Failed to import settings:', err.message);
    }
}

function openQR(path, app, tag, title, singboxType) {
    const qrModal = document.getElementById('qrModal');
    const qrcodeContainer = document.getElementById('qrcode-container');
    const url = generateSubUrl(path, app, tag, singboxType);
    let qrcodeTitle = document.getElementById("qrcodeTitle");
    qrcodeTitle.textContent = title;
    qrModal.style.display = "block";
    let qrcodeDiv = document.createElement("div");
    qrcodeDiv.className = "qrcode";
    qrcodeDiv.style.padding = "2px";
    qrcodeDiv.style.backgroundColor = "#ffffff";
    /* global QRCode */
    new QRCode(qrcodeDiv, {
        text: url,
        width: 256,
        height: 256,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });

    qrcodeContainer.appendChild(qrcodeDiv);
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(() => alert('✅ Copied to clipboard:\n\n' + text))
        .catch(error => console.error('Failed to copy:', error));
}

async function updateWarpConfigs() {
    const confirmReset = confirm('⚠️ Are you sure?');
    if (!confirmReset) return;
    const refreshBtn = document.getElementById('warp-update');
    document.body.style.cursor = 'wait';
    refreshBtn.classList.add('fa-spin');

    try {
        const response = await fetch('/panel/update-warp', { method: 'POST', credentials: 'include' });
        const { success, status, message } = await response.json();

        document.body.style.cursor = 'default';
        refreshBtn.classList.remove('fa-spin');

        if (!success) {
            alert(
                '⚠️ An error occured, Please try again!\n' +
                `⛔ ${message}`
            );

            throw new Error(`status ${status} - ${message}`);
        }

        alert('✅ Warp configs updated successfully!');
    } catch (error) {
        console.error("Updating Warp configs error:", error.message || error)
    }
}

function handleProtocolChange(event) {
    if (event.target.checked) {
        globalThis.activeProtocols++;
        return true;
    }

    globalThis.activeProtocols--;

    if (globalThis.activeProtocols === 0) {
        event.preventDefault();
        event.target.checked = !event.target.checked;
        alert("⛔ At least one Protocol should be selected!");
        globalThis.activeProtocols++;
        return false;
    }
}

function handlePortChange(event) {
    const portField = Number(event.target.name);

    if (event.target.checked) {
        globalThis.activeTlsPorts.push(portField);
        return true;
    }

    globalThis.activeTlsPorts = globalThis.activeTlsPorts.filter(port => port !== portField);

    if (globalThis.activeTlsPorts.length === 0) {
        event.preventDefault();
        event.target.checked = !event.target.checked;
        alert("⛔ At least one TLS port should be selected!");
        globalThis.activeTlsPorts.push(portField);
        return false;
    }
}

function handleRiskyRules(event) {
    if (event.target.checked) {
        const proceed = confirm(
            "⛔ v2ray users should set Geo Assets to Chocolate4U and download assets, otherwise configs won't connect.\n\n" +
            "❓ Proceed?"
        );

        if (!proceed) {
            event.target.checked = false;
            return;
        }
    }
}

function handleFragmentMode() {
    const fragmentMode = document.getElementById("fragmentMode").value;
    const formDataObj = Object.fromEntries(globalThis.initialFormData.entries());
    const inputs = [
        "fragmentLengthMin",
        "fragmentLengthMax",
        "fragmentIntervalMin",
        "fragmentIntervalMax"
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
        fragmentMode !== "custom"
            ? elm.setAttribute('readonly', 'true')
            : elm.removeAttribute('readonly');
    });
}

function resetSettings() {
    const confirmReset = confirm('⚠️ This will reset all panel settings.\n\n❓ Are you sure?');
    if (!confirmReset) return;

    const resetBtn = document.getElementById("refresh-btn");
    resetBtn.classList.add('fa-spin');
    const body = { resetSettings: true };
    document.body.style.cursor = 'wait';

    fetch('/panel/reset-settings', {
        method: 'POST',
        body: JSON.stringify(body),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    })
        .then(response => response.json())
        .then(({ success, status, message, body }) => {
            document.body.style.cursor = 'default';
            resetBtn.classList.remove('fa-spin');

            if (!success) {
                throw new Error(`status ${status} - ${message}`);
            }

            initiatePanel(body);
            alert('✅ Panel settings reset to default successfully!\n💡 Please update your subscriptions.');
        })
        .catch(error => console.error("Reseting settings error:", error.message || error));
}

function updateSettings(event, data) {
    event.preventDefault();
    event.stopPropagation();

    const validatedForm = validateSettings();
    if (!validatedForm) return false;

    const form = data ? data : validatedForm;
    const applyButton = document.getElementById('applyButton');
    document.body.style.cursor = 'wait';
    const applyButtonVal = applyButton.value;
    applyButton.value = '⌛ Loading...';

    fetch('/panel/update-settings', {
        method: 'PUT',
        body: JSON.stringify(form),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    })
        .then(response => response.json())
        .then(({ success, status, message }) => {

            if (status === 401) {
                alert('⚠️ Session expired! Please login again.');
                window.location.href = '/login';
            }

            if (!success) {
                throw new Error(`status ${status} - ${message}`);
            }

            initiatePanel(form);
            alert('✅ Settings applied successfully!\n💡 Please update your subscriptions.');
        })
        .catch(error => console.error("Update settings error:", error.message || error))
        .finally(() => {
            document.body.style.cursor = 'default';
            applyButton.value = applyButtonVal;
        });
}

function parseElmValues(id) {
    return document.getElementById(id).value?.split('\n')
        .map(value => value.trim())
        .filter(Boolean) || [];
}

function getElmValue(id) {
    return document.getElementById(id).value?.trim();
}

function isDomain(value) {
    const domainRegex = /^(?=.{1,253}$)(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)\.)+[a-zA-Z]{2,63}$/;
    return domainRegex.test(value);
}

function isIPv4(value) {
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
    return ipv4Regex.test(value);
}

function isIPv4CIDR(value) {
    const ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\/(?:[0-9]|[1-2][0-9]|3[0-2]))?$/;
    return ipv4CidrRegex.test(value);
}

function isIPv6(value) {
    const ipv6Regex = /^\[(?:(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,7}:|(?:[a-fA-F0-9]{1,4}:){1,6}:[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,5}(?::[a-fA-F0-9]{1,4}){1,2}|(?:[a-fA-F0-9]{1,4}:){1,4}(?::[a-fA-F0-9]{1,4}){1,3}|(?:[a-fA-F0-9]{1,4}:){1,3}(?::[a-fA-F0-9]{1,4}){1,4}|(?:[a-fA-F0-9]{1,4}:){1,2}(?::[a-fA-F0-9]{1,4}){1,5}|[a-fA-F0-9]{1,4}:(?::[a-fA-F0-9]{1,4}){1,6}|:(?::[a-fA-F0-9]{1,4}){1,7})\]$/;
    return ipv6Regex.test(value);
}

function isIPv6CIDR(value) {
    const ipv6CidrRegex = /^(?:(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,7}:|(?:[a-fA-F0-9]{1,4}:){1,6}:[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,5}(?::[a-fA-F0-9]{1,4}){1,2}|(?:[a-fA-F0-9]{1,4}:){1,4}(?::[a-fA-F0-9]{1,4}){1,3}|(?:[a-fA-F0-9]{1,4}:){1,3}(?::[a-fA-F0-9]{1,4}){1,4}|(?:[a-fA-F0-9]{1,4}:){1,2}(?::[a-fA-F0-9]{1,4}){1,5}|[a-fA-F0-9]{1,4}:(?::[a-fA-F0-9]{1,4}){1,6}|:(?::[a-fA-F0-9]{1,4}){1,7}|::)(?:\/(?:12[0-8]|1[01]?[0-9]|[0-9]?[0-9]))?$/;
    return ipv6CidrRegex.test(value);
}

function parseHostPort(input) {
    const regex = /^(?<host>\[.*?\]|[^:]+)(?::(?<port>\d+))?$/;
    const match = input.match(regex);

    if (!match) return null;

    return {
        host: match.groups.host,
        port: match.groups.port ? +match.groups.port : null
    };
}

function isValidHostName(value, isHost) {
    const hostPort = parseHostPort(value.trim());
    if (!hostPort) return false;
    const { host, port } = hostPort;
    if (port && (port > 65535 || port < 1)) return false;
    if (isHost && !port) return false;

    return isIPv6(host) || isIPv4(host) || isDomain(host);
}

function validateRemoteDNS() {
    let url;
    const dns = getElmValue("remoteDNS");

    try {
        url = new URL(dns);
    } catch (error) {
        alert("⛔ Invalid DNS, Please enter a URL.");
        return false;
    }

    const cloudflareDNS = [
        '1.1.1.1',
        '1.0.0.1',
        '1.1.1.2',
        '1.0.0.2',
        '1.1.1.3',
        '1.0.0.3',
        '2606:4700:4700::1111',
        '2606:4700:4700::1001',
        '2606:4700:4700::1112',
        '2606:4700:4700::1002',
        '2606:4700:4700::1113',
        '2606:4700:4700::1003',
        'cloudflare-dns.com',
        'security.cloudflare-dns.com',
        'family.cloudflare-dns.com',
        'one.one.one.one',
        '1dot1dot1dot1'
    ];

    if (!["tcp:", "https:", "tls:"].includes(url.protocol)) {
        alert("⛔ Please enter TCP, DoH or DoT servers.");
        return false;
    }

    if (cloudflareDNS.includes(url.hostname)) {
        alert(
            "⛔ Cloudflare DNS is not allowed for workers.\n" +
            "💡 Please use other public DNS servers like Google, Adguard..."
        );

        return false;
    }

    return true;
}

function validateSanctionDns() {
    const dns = getElmValue("antiSanctionDNS");
    let host;

    try {
        const url = new URL(dns);
        host = url.hostname;
    } catch {
        host = dns;
    }

    const isValid = isValidHostName(host, false);

    if (!isValid) {
        alert(
            '⛔ Invalid IPs or Domains.\n' +
            `⚠️ ${host}`
        );

        return false;
    }

    return true;
}

function validateWarpDNS() {
    const dns = getElmValue("warpRemoteDNS");
    const isValid = isIPv4(dns);

    if (!isValid) {
        alert(
            '⛔ Invalid Warp DNS.\n' +
            '💡 Please fill in an IPv4 address (UDP DNS).\n\n' +
            `⚠️ ${dns}`
        );

        return false;
    }

    return true;
}

function validateLocalDNS() {
    const dns = getElmValue("localDNS");
    const isValid = isIPv4(dns) || dns === 'localhost';

    if (!isValid) {
        alert(
            '⛔ Invalid local DNS.\n' +
            '💡 Please fill in an IPv4 address or "localhost".\n\n' +
            `⚠️ ${dns}`
        );

        return false;
    }

    return true;
}

function validateCustomRules() {
    const invalidDomainIpValues = [
        'customBypassRules',
        'customBlockRules'
    ].flatMap(parseElmValues)
        .filter(value => !isIPv4CIDR(value) && !isIPv6CIDR(value) && !isDomain(value));

    const invalidDomainValues = parseElmValues('customBypassSanctionRules').filter(value => !isDomain(value));

    if (invalidDomainIpValues.length) {
        alert(
            '⛔ Invalid IPs, Domains or IP ranges.\n' +
            '💡 Please enter each value in a new line.\n\n' +
            invalidDomainIpValues.map(val => `⚠️ ${val}`).join('\n')
        );

        return false;
    }

    if (invalidDomainValues.length) {
        alert(
            '⛔ Invalid Domains.\n💡 Please enter each value in a new line.\n\n' +
            invalidDomainValues.map(val => `⚠️ ${val}`).join('\n')
        );

        return false;
    }

    return true;
}

function validateMultipleHostNames() {
    const fields = ['cleanIPs', 'customCdnAddrs', 'customCdnSni', 'customCdnHost'];
    const invalidValues = [];

    for (const field of fields) {
        const values = parseElmValues(field);
        for (const value of values) {
            let addr = value;
            // 仅对 cleanIPs 允许 '#' 备注
            if (field === 'cleanIPs') {
                const hashIndex = value.indexOf('#');
                if (hashIndex !== -1) {
                    addr = value.substring(0, hashIndex).trim();
                }
            }
            if (!isValidHostName(addr)) {
                invalidValues.push(value);
            }
        }
    }

    if (invalidValues.length) {
        alert(
            '⛔ Invalid IPs or Domains.\n' +
            '💡 Please enter each value in a new line.\n\n' +
            invalidValues.map(val => `⚠️ ${val}`).join('\n')
        );
        return false;
    }

    return true;
}

function validateProxyIPs() {
    const invalidValues = parseElmValues('proxyIPs')
        .filter(value => !isValidHostName(value));

    if (invalidValues.length) {
        alert(
            '⛔ Invalid proxy IPs.\n' +
            '💡 Please enter each value in a new line.\n\n' +
            invalidValues.map(ip => `⚠️ ${ip}`).join('\n')
        );

        return false;
    }

    return true;
}

function validateNAT64Prefixes() {
    const invalidValues = parseElmValues('prefixes')
        .filter(value => !isIPv6(value));

    if (invalidValues.length) {
        alert(
            '⛔ Invalid NAT64 prefix.\n' +
            '💡 Please enter each prefix in a new line using [].\n\n' +
            invalidValues.map(ip => `⚠️ ${ip}`).join('\n')
        );

        return false;
    }

    return true;
}

function validateWarpEndpoints() {
    const invalidEndpoints = parseElmValues('warpEndpoints')
        .filter(value => !isValidHostName(value, true));

    if (invalidEndpoints.length) {
        alert(
            '⛔ Invalid endpoint.\n\n' +
            invalidEndpoints.map(endpoint => `⚠️ ${endpoint}`).join('\n')
        );

        return false;
    }

    return true;
}

function validateMinMax() {
    const getValue = (id) => parseInt(getElmValue(id), 10);

    const fields = [
        ['fragmentLengthMin', 'fragmentLengthMax', 'Fragment Length'],
        ['fragmentIntervalMin', 'fragmentIntervalMax', 'Fragment Interval'],
        ['fragmentMaxSplitMin', 'fragmentMaxSplitMax', 'Fragment Max Split'],
        ['noiseCountMin', 'noiseCountMax', 'Noise Count'],
        ['noiseSizeMin', 'noiseSizeMax', 'Noise Size'],
        ['noiseDelayMin', 'noiseDelayMax', 'Noise Delay'],
        ['amneziaNoiseSizeMin', 'amneziaNoiseSizeMax', 'Amnezia Noise Size']
    ];

    for (const [minId, maxId, label] of fields) {
        const min = getValue(minId);
        const max = getValue(maxId);

        if (min > max) {
            alert(`⛔ ${label}: Minimum cannot be bigger than Maximum!`);
            return false;
        }
    }

    return true;
}

function validateChainProxy() {
    let chainProxy = getElmValue('outProxy');
    if (!chainProxy) return true;
    const isVMess = /vmess:\/\/.+$/.test(chainProxy);
    const isOthers = /(http|socks|socks5|vless|trojan|ss):\/\/[^\s@]+@[^\s:]+:[^\s]+/.test(chainProxy);

    if (!isVMess && !isOthers) {
        alert(
            '⛔ Invalid Config!\n' +
            '💡 Standard formats are:\n\n' +
            ' + (socks or socks5 or http)://user:pass@server:port\n' +
            ' + (socks or socks5 or http)://base64@server:port\n' +
            ' + vless://uuid@server:port...\n' +
            ' + vmess://base64\n' +
            ' + trojan://password@server:port...\n' +
            ' + ss://base64@server:port...'
        );

        return false;
    }

    const config = new URL(chainProxy);
    let { protocol, username } = config;
    let security = config.searchParams.get('security');
    let type = config.searchParams.get('type');

    if (isVMess) {
        const vmConfig = JSON.parse(atob(config.host));
        username = vmConfig.id;
        security = vmConfig.tls;
        type = vmConfig.net;
    }

    if (['vless:', 'trojan:', 'vmess:'].includes(protocol)) {
        if (!username) {
            alert(
                '⛔ Invalid Config!\n' +
                '💡 Config URL should contain UUID or Password.'
            );

            return false;
        }

        if (security && !['tls', 'none', 'reality'].includes(security)) {
            alert(
                '⛔ Invalid Config!\n' +
                '💡 VLESS, VMess or Trojan security can be TLS, Reality or None.'
            );

            return false;
        }

        if (!['tcp', 'raw', 'ws', 'grpc', 'httpupgrade'].includes(type)) {
            alert(
                '⛔ Invalid Config!\n' +
                '💡 VLESS, VMess or Trojan transmission can be tcp, ws, grpc or httpupgrade.'
            );

            return false;
        }
    }

    return true;
}

function validateCustomCdn() {
    const customCdnHost = getElmValue('customCdnHost');
    const customCdnSni = getElmValue('customCdnSni');
    const customCdnAddrs = parseElmValues('customCdnAddrs');
    const isCustomCdn = customCdnAddrs.length || customCdnHost !== '' || customCdnSni !== '';

    if (isCustomCdn && !(customCdnAddrs.length && customCdnHost && customCdnSni)) {
        alert('⛔ All "Custom" fields should be filled or deleted together!');
        return false;
    }

    return true;
}

function validateKnockerNoise() {
    const regex = /^(none|quic|random|[0-9A-Fa-f]+)$/;
    const knockerNoise = getElmValue("knockerNoiseMode");

    if (!regex.test(knockerNoise)) {
        alert(
            '⛔ Invalid noise  mode.\n' +
            '💡 Please use "none", "quic", "random" or a valid hex value.'
        );

        return false;
    }

    return true;
}

function validateXrayNoises(fields) {
    const [modes, packets, delaysMin, delaysMax] = fields;
    const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
    let submisionError = false;

    modes.forEach((mode, index) => {
        if (Number(delaysMin[index]) > Number(delaysMax[index])) {
            alert('⛔ The minimum noise delay should be smaller or equal to maximum!');
            submisionError = true;
            return;
        }

        switch (mode) {
            case 'base64': {
                if (!base64Regex.test(packets[index])) {
                    alert('⛔ The Base64 noise packet is not a valid base64 value!');
                    submisionError = true;
                }

                break;
            }
            case 'rand': {
                if (!(/^\d+-\d+$/.test(packets[index]))) {
                    alert('⛔ The Random noise packet should be a range like 0-10 or 10-30!');
                    submisionError = true;
                }

                const [min, max] = packets[index].split("-").map(Number);

                if (min > max) {
                    alert('⛔ The minimum Random noise packet should be smaller or equal to maximum!');
                    submisionError = true;
                }

                break;
            }
            case 'hex': {
                if (!(/^(?=(?:[0-9A-Fa-f]{2})*$)[0-9A-Fa-f]+$/.test(packets[index]))) {
                    alert(
                        '⛔ The Hex noise packet is not a valid hex value!\n' +
                        '💡 It should have even length and consisted of 0-9, a-f and A-F.'
                    );
                    submisionError = true;
                }

                break;
            }
        }
    });

    return !submisionError;
}

function validateSettings() {
    const configForm = document.getElementById('configForm');
    const formData = new FormData(configForm);

    const fields = [
        'udpXrayNoiseMode',
        'udpXrayNoisePacket',
        'udpXrayNoiseDelayMin',
        'udpXrayNoiseDelayMax',
        'udpXrayNoiseCount',
        'applyTo'
    ].map(field => formData.getAll(field));

    const validations = [
        validateRemoteDNS(),
        validateSanctionDns(),
        validateLocalDNS(),
        validateWarpDNS(),
        validateMultipleHostNames(),
        validateProxyIPs(),
        validateNAT64Prefixes(),
        validateWarpEndpoints(),
        validateMinMax(),
        validateChainProxy(),
        validateCustomCdn(),
        validateKnockerNoise(),
        validateXrayNoises(fields),
        validateCustomRules()
    ];

    if (!validations.every(Boolean)) {
        return false;
    }

    const form = Object.fromEntries(formData.entries());
    const [modes, packets, delaysMin, delaysMax, counts, applyTo] = fields;

    form.xrayUdpNoises = modes.map((mode, index) => ({
        type: mode,
        packet: packets[index],
        delay: `${delaysMin[index]}-${delaysMax[index]}`,
        applyTo: applyTo[index],
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

    return form;
}

function logout(event) {
    event.preventDefault();
    fetch('/logout', { method: 'GET', credentials: 'same-origin' })
        .then(response => response.json())
        .then(({ success, status, message }) => {
            if (!success) {
                throw new Error(`status ${status} - ${message}`);
            }

            window.location.href = '/login';
        })
        .catch(error => console.error("Logout error:", error.message || error));
}

function resetPassword(event) {
    event.preventDefault();
    const resetPassModal = document.getElementById('resetPassModal');
    const newPasswordInput = document.getElementById('newPassword');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    const passwordError = document.getElementById('passwordError');
    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (newPassword !== confirmPassword) {
        passwordError.textContent = "Passwords do not match";
        return false;
    }

    const hasCapitalLetter = /[A-Z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    const isLongEnough = newPassword.length >= 8;

    if (!(hasCapitalLetter && hasNumber && isLongEnough)) {
        passwordError.textContent = '⚠️ Password must contain at least one capital letter, one number, and be at least 8 characters long.';
        return false;
    }

    fetch('/panel/reset-password', {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain'
        },
        body: newPassword,
        credentials: 'same-origin'
    })
        .then(response => response.json())
        .then(({ success, status, message }) => {
            if (!success) {
                passwordError.textContent = `⚠️ ${message}`;
                throw new Error(`status ${status} - ${message}`);
            }

            alert("✅ Password changed successfully! 👍");
            window.location.href = '/login';

        })
        .catch(error => console.error("Reset password error:", error.message || error))
        .finally(() => {
            resetPassModal.style.display = "none";
            document.body.style.overflow = "";
        });
}

function renderPortsBlock(ports) {
    let noneTlsPortsBlock = '', tlsPortsBlock = '';
    const totalPorts = [
        ...(window.origin.includes('workers.dev') ? defaultHttpPorts : []),
        ...defaultHttpsPorts
    ];

    totalPorts.forEach(port => {
        const isChecked = ports.includes(port) ? 'checked' : '';
        let clss = '', handler = '';

        if (defaultHttpsPorts.includes(port)) {
            clss = 'class="https"';
            handler = 'onclick="handlePortChange(event)"';
        }

        const portBlock = `
            <div class="routing">
                <input type="checkbox" name=${port} ${clss} value="true" ${isChecked} ${handler}>
                <label>${port}</label>
            </div>`;

        defaultHttpsPorts.includes(port)
            ? tlsPortsBlock += portBlock
            : noneTlsPortsBlock += portBlock;
    });

    document.getElementById("tls-ports").innerHTML = tlsPortsBlock;

    if (noneTlsPortsBlock) {
        document.getElementById("non-tls-ports").innerHTML = noneTlsPortsBlock;
        document.getElementById("none-tls").style.display = 'flex';
    }
}

function addUdpNoise(isManual, noiseIndex, udpNoise) {
    const index = noiseIndex ?? globalThis.xrayNoiseCount;
    const noise = udpNoise || {
        type: 'rand',
        packet: '50-100',
        delay: '1-5',
        applyTo: 'ip',
        count: 5
    };

    const container = document.createElement('div');
    container.className = "inner-container";
    container.id = `udp-noise-${index + 1}`;

    container.innerHTML = `
        <div class="header-container">
            <h4>Noise ${index + 1}</h4>
            <button type="button" class="delete-noise">
                <span class="material-symbols-rounded">delete</span>
            </button>      
        </div>
        <div class="section">
            <div class="form-control">
                <label>😵‍💫 Mode</label>
                <div>
                    <select name="udpXrayNoiseMode">
                        <option value="base64" ${noise.type === 'base64' ? 'selected' : ''}>Base64</option>
                        <option value="rand" ${noise.type === 'rand' ? 'selected' : ''}>Random</option>
                        <option value="str" ${noise.type === 'str' ? 'selected' : ''}>String</option>
                        <option value="hex" ${noise.type === 'hex' ? 'selected' : ''}>Hex</option>
                    </select>
                </div>
            </div>
            <div class="form-control">
                <label>📦 Packet</label>
                <div>
                    <input type="text" name="udpXrayNoisePacket" value="${noise.packet}">
                </div>
            </div>
            <div class="form-control">
                <label>🎚️ Count</label>
                <div>
                    <input type="number" name="udpXrayNoiseCount" value="${noise.count}" min="1" required>
                </div>
            </div>
            <div class="form-control">
                <label>🕞 Delay</label>
                <div class="min-max">
                    <input type="number" name="udpXrayNoiseDelayMin"
                        value="${noise.delay.split('-')[0]}" min="1" required>
                    <span> - </span>
                    <input type="number" name="udpXrayNoiseDelayMax"
                        value="${noise.delay.split('-')[1]}" min="1" required>
                </div>
            </div>
            <div class="form-control">
                <label>⚙️ Applies to</label>
                <div>
                    <select name="applyTo">
                        <option value="ip" ${!noise.applyTo || noise.applyTo === 'ip' ? 'selected' : ''}>IP</option>
                        <option value="ipv4" ${noise.applyTo === 'ipv4' ? 'selected' : ''}>IPv4</option>
                        <option value="ipv6" ${noise.applyTo === 'ipv6' ? 'selected' : ''}>IPv6</option>
                    </select>
                </div>
            </div>
        </div>`;

    container.querySelector(".delete-noise").addEventListener('click', deleteUdpNoise);
    container.querySelector("select").addEventListener('change', generateUdpNoise);

    document.getElementById("noises").append(container);
    if (isManual) enableApplyButton();
    globalThis.xrayNoiseCount++;
}

function generateUdpNoise(event) {
    const generateRandomBase64 = length => {
        const array = new Uint8Array(Math.ceil(length * 3 / 4));
        crypto.getRandomValues(array);
        let base64 = btoa(String.fromCharCode(...array));

        return base64.slice(0, length);
    }

    const generateRandomHex = length => {
        const array = new Uint8Array(Math.ceil(length / 2));
        crypto.getRandomValues(array);
        let hex = [...array].map(b => b.toString(16).padStart(2, '0')).join('');

        return hex.slice(0, length);
    }

    const generateRandomString = length => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const array = new Uint8Array(length);

        return Array.from(crypto.getRandomValues(array), x => chars[x % chars.length]).join('');
    };

    const noisePacket = event.target.closest(".inner-container").querySelector('[name="udpXrayNoisePacket"]');

    switch (event.target.value) {
        case 'base64':
            noisePacket.value = generateRandomBase64(64);
            break;

        case 'rand':
            noisePacket.value = "50-100";
            break;

        case 'hex':
            noisePacket.value = generateRandomHex(64);
            break;

        case 'str':
            noisePacket.value = generateRandomString(64);
            break;
    }
}

function deleteUdpNoise(event) {
    if (globalThis.xrayNoiseCount === 1) {
        alert('⛔ You cannot delete all noises!');
        return;
    }

    const confirmReset = confirm(
        '⚠️ This will delete the noise.\n\n' +
        '❓ Are you sure?'
    );

    if (!confirmReset) return;
    event.target.closest(".inner-container").remove();
    enableApplyButton();
    globalThis.xrayNoiseCount--;
}

function renderUdpNoiseBlock(xrayUdpNoises) {
    document.getElementById("noises").innerHTML = '';
    xrayUdpNoises.forEach((noise, index) => {
        addUdpNoise(false, index, noise);
    });

    globalThis.xrayNoiseCount = xrayUdpNoises.length;
}

// ============ 背景设置 ============
function openBgModal() {
    fetch('/panel/background-config')
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                document.getElementById('bgImageInput').value = data.body.image || '';
                document.getElementById('bgPositionSelect').value = data.body.position || 'left';
                document.getElementById('bgOpacityInput').value = data.body.opacity || 0.9;
                document.getElementById('bgModal').style.display = 'block';
            } else {
                alert('获取背景配置失败');
            }
        })
        .catch(err => {
            console.error(err);
            alert('获取背景配置出错');
        });
}

// ============ 背景 ============
function saveBackground() {
    const image = document.getElementById('bgImageInput').value.trim();
    const position = document.getElementById('bgPositionSelect').value;
    const opacity = parseFloat(document.getElementById('bgOpacityInput').value);
    if (!image) {
        alert('请输入背景图地址');
        return;
    }
    if (isNaN(opacity) || opacity < 0 || opacity > 1) {
        alert('透明度必须在 0 ~ 1 之间');
        return;
    }
    const config = { image, position, opacity };
    fetch('/panel/background-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            // 应用并同步输入框
            applyBackgroundToPage(image, position, opacity);
            // 确保输入框值与配置一致
            document.getElementById('bgImageInput').value = image;
            document.getElementById('bgPositionSelect').value = position;
            document.getElementById('bgOpacityInput').value = opacity;
            alert('✅ 背景设置已保存');
            // 可选：折叠面板自动收起
            // document.getElementById('bgDetails').open = false;
        } else {
            alert('保存失败: ' + (data.message || '未知错误'));
        }
    })
    .catch(err => {
        console.error(err);
        alert('保存请求失败，请检查网络或稍后重试');
    });
}

function resetBackground() {
    if (!confirm('确定重置为默认背景吗？')) return;
    fetch('/panel/reset-background', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const defaultBg = {
                    image: 'https://framagit.org/Falcon/Source/-/raw/main/background/Toomi_15.jpg?ref_type=heads',
                    position: 'left',
                    opacity: 0.85
                };
                applyBackgroundToPage(defaultBg.image, defaultBg.position, defaultBg.opacity);
                document.getElementById('bgImageInput').value = defaultBg.image;
                document.getElementById('bgPositionSelect').value = defaultBg.position;
                document.getElementById('bgOpacityInput').value = defaultBg.opacity;
                alert('✅ 已重置为默认背景');
            } else {
                alert('重置失败');
            }
        })
        .catch(err => {
            console.error(err);
            alert('重置请求失败');
        });
}

function applyBackgroundToPage(image, position, opacity) {
    // 使用 setProperty 添加 !important 覆盖 CSS
    document.body.style.setProperty('background-image', `url(${image})`, 'important');
    document.body.style.setProperty('background-position', position, 'important');
    document.body.style.setProperty('background-size', 'cover', 'important');
    document.body.style.setProperty('background-attachment', 'fixed', 'important');
    document.querySelectorAll('.container').forEach(el => {
        el.style.setProperty('opacity', opacity, 'important');
    });
}

function loadBackgroundOnInit() {
    fetch('/panel/background-config')
        .then(res => res.json())
        .then(data => {
            if (data.success && data.body) {
                const { image, position, opacity } = data.body;
                if (image) {
                    // 应用背景样式
                    applyBackgroundToPage(image, position, opacity);
                    // 填充输入框
                    document.getElementById('bgImageInput').value = image;
                    document.getElementById('bgPositionSelect').value = position;
                    document.getElementById('bgOpacityInput').value = opacity;
                }
            }
        })
        .catch(err => console.error('加载背景配置失败:', err));
}

// ============ Base64 图片转换 ============
function convertBgImageToBase64() {
    const fileInput = document.getElementById('bgImageFile');
    const file = fileInput.files[0];
    if (!file) {
        alert('请先选择一张图片');
        return;
    }
    if (!file.type.match('image.*')) {
        alert('请选择图片文件');
        fileInput.value = '';
        return;
    }
    // 文件大小限制（建议 700KB）
    if (file.size > 0.7 * 1024 * 1024) {
        alert('图片文件大小不能超过 700KB');
        fileInput.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const base64 = e.target.result;
        // 预览
        document.getElementById('bgPreviewImg').src = base64;
        document.getElementById('bgImagePreview').style.display = 'block';
        // 显示 Base64
        document.getElementById('bgBase64Result').value = base64;
        showToast('图片已成功转换为 Base64 编码');
    };
    reader.onerror = function() {
        alert('图片读取失败，请重试');
    };
    reader.readAsDataURL(file);
}

function copyBgBase64() {
    const result = document.getElementById('bgBase64Result');
    if (!result.value) {
        alert('没有可复制的 Base64 编码');
        return;
    }
    navigator.clipboard.writeText(result.value)
        .then(() => showToast('Base64 编码已复制到剪贴板'))
        .catch(() => {
            result.select();
            document.execCommand('copy');
            showToast('Base64 编码已复制到剪贴板');
        });
}

function applyBgBase64AsBackground() {
    const result = document.getElementById('bgBase64Result');
    if (!result.value) {
        alert('请先转换一张图片生成 Base64');
        return;
    }
    // 将 Base64 填入背景图 URL 输入框
    document.getElementById('bgImageInput').value = result.value;
    // 可选：自动保存背景设置（调用 saveBackground）
    if (confirm('是否立即保存背景设置？')) {
        saveBackground();
    } else {
        showToast('已将 Base64 填入背景图输入框，点击“保存”按钮应用');
    }
}

function clearBgBase64() {
    document.getElementById('bgImageFile').value = '';
    document.getElementById('bgImagePreview').style.display = 'none';
    document.getElementById('bgBase64Result').value = '';
    showToast('已清除');
}

// 简单的 Toast 提示（如果页面未定义 showToast，则实现一个简易版）
if (typeof showToast !== 'function') {
    function showToast(message) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `<div style="background:#48bb78; border-radius:50%; width:20px; height:20px; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold;">✓</div>
                           <div style="color:#2d3748; font-size:14px; font-weight:500; margin-left:8px;">${message}</div>`;
        toast.style.cssText = `position:fixed; top:20px; right:20px; background:white; border-left:4px solid #48bb78; border-radius:8px; padding:12px 16px; box-shadow:0 4px 12px rgba(0,0,0,0.15); display:flex; align-items:center; gap:10px; z-index:1000; opacity:0; transform:translateX(100%); transition:all 0.3s ease; max-width:300px;`;
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(0)';
        });
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }
}

// ============ Cloudflare 用量查询 ============
async function fetchcloudflareInfo() {
    const refreshBtn = document.getElementById('refresh-cloudflare');
    const icon = refreshBtn?.querySelector('i');
    if (icon) icon.classList.add('fa-spin');

    try {
        // 获取 Request 和 KV 用量
        const [usageRes, kvRes] = await Promise.all([
            fetch('/panel/cloudflare-usage'),
            fetch('/panel/kv-usage')
        ]);
        const usageData = await usageRes.json();
        const kvData = await kvRes.json();

        // 更新 Request 行
        if (usageData.success) {
            const total = usageData.pages + usageData.workers;
            document.getElementById('cf-request-used').textContent = total.toLocaleString();
            document.getElementById('cf-request-percent').textContent = usageData.percentage + '%';
        } else {
            document.getElementById('cf-request-used').textContent = '--';
            document.getElementById('cf-request-percent').textContent = '--';
        }

        // 更新 KV 行
        if (kvData.success) {
            document.getElementById('cf-kv-read-used').textContent = kvData.readTotal.toLocaleString();
            document.getElementById('cf-kv-read-percent').textContent = kvData.readPercentage + '%';
            document.getElementById('cf-kv-write-used').textContent = kvData.writeTotal.toLocaleString();
            document.getElementById('cf-kv-write-percent').textContent = kvData.writePercentage + '%';

            // 各空间详情
            let detailsHtml = '';
            if (kvData.details && kvData.details.length) {
                detailsHtml = kvData.details.map(ns =>
                    `<div><strong>${ns.namespaceName}</strong> 读:${ns.read} 写:${ns.write} 删:${ns.delete} 列:${ns.list}</div>`
                ).join('');
            } else {
                detailsHtml = '暂无数据';
            }
            document.getElementById('cf-kv-details').innerHTML = detailsHtml;
        } else {
            document.getElementById('cf-kv-read-used').textContent = '--';
            document.getElementById('cf-kv-read-percent').textContent = '--';
            document.getElementById('cf-kv-write-used').textContent = '--';
            document.getElementById('cf-kv-write-percent').textContent = '--';
            document.getElementById('cf-kv-details').textContent = '获取失败';
        }
    } catch (err) {
        console.error('获取 Cloudflare 用量失败:', err);
        // 清空所有显示
        document.querySelectorAll('#cf-usage-table td:not(:first-child)').forEach(td => td.textContent = '--');
        document.getElementById('cf-kv-details').textContent = '加载失败';
    } finally {
        if (icon) icon.classList.remove('fa-spin');
    }
}

// 加载 Cloudflare 配置到表单
async function loadCloudflareConfig() {
    try {
        const res = await fetch('/panel/cloudflare-config');
        const data = await res.json();
        if (data.success && data.body) {
            document.getElementById('cfAccountId').value = data.body.accountId || '';
            document.getElementById('cfApiToken').value = data.body.apiToken || '';
            document.getElementById('cfEmail').value = data.body.email || '';
            document.getElementById('cfGlobalApiKey').value = data.body.globalApiKey || '';
        }
    } catch (err) {
        console.error('加载 Cloudflare 配置失败:', err);
    }
}

// 保存 Cloudflare 配置
function saveCloudflareConfig() {
    const config = {
        accountId: document.getElementById('cfAccountId').value.trim(),
        apiToken: document.getElementById('cfApiToken').value.trim(),
        email: document.getElementById('cfEmail').value.trim(),
        globalApiKey: document.getElementById('cfGlobalApiKey').value.trim()
    };

    // 至少要有 Account ID + (Token 或 Email+GlobalKey)
    if (!config.accountId) {
        alert('请填写 Account ID');
        return;
    }
    if (!config.apiToken && (!config.email || !config.globalApiKey)) {
        alert('请填写 API Token 或 (Email + Global API Key)');
        return;
    }

    fetch('/panel/cloudflare-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert('✅ Cloudflare 配置已保存');
        } else {
            alert('保存失败: ' + data.message);
        }
    })
    .catch(err => {
        alert('保存请求失败: ' + err.message);
    });
}

// 清除 Cloudflare 配置
function clearCloudflareConfig() {
    if (!confirm('确定清除 Cloudflare 配置吗？')) return;
    const empty = { accountId: '', apiToken: '', email: '', globalApiKey: '' };
    fetch('/panel/cloudflare-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(empty)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            document.getElementById('cfAccountId').value = '';
            document.getElementById('cfApiToken').value = '';
            document.getElementById('cfEmail').value = '';
            document.getElementById('cfGlobalApiKey').value = '';
            alert('✅ 配置已清除');
        } else {
            alert('清除失败: ' + data.message);
        }
    })
    .catch(err => alert('请求失败: ' + err.message));
}
