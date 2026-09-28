document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = document.getElementById('password').value;

    try {
        const response = await fetch('/login/authenticate', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: password
        });

        const { success, status, message } = await response.json();
        if (!success) {
            const passwordError = document.getElementById("passwordError");
            passwordError.textContent = '⚠️ Wrong Password!';
            throw new Error(`Login failed with status ${status}: ${message}`);
        }

        // 完全重载进入主页：
        // 1. replace 不留登录页在历史记录，避免回退时又见登录页
        // 2. 加时间戳参数强制绕过浏览器 bfcache / 缓存，从服务器拉取最新 HTML
        window.location.replace('/panel?_t=' + Date.now());
    } catch (error) {
        console.error('Login error:', error.message || error);
    }
});

document.getElementById("togglePassword").addEventListener("click", function () {
    const passwordInput = document.getElementById("password");
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    this.textContent = isPassword ? "visibility_off" : "visibility";
});
