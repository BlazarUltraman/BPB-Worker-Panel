
// ====== 新增：加载背景配置 ======
async function loadBackground() {
    try {
        const response = await fetch('/panel/background-config');
        const data = await response.json();
        if (data.success && data.body && data.body.image) {
            const { image, position, opacity } = data.body;
            document.body.style.backgroundImage = `url(${image})`;
            document.body.style.backgroundPosition = position || 'left';
            document.body.style.backgroundSize = 'cover';
            document.body.style.backgroundAttachment = 'fixed';
            if (opacity !== undefined) {
                const container = document.querySelector('.container');
                if (container) container.style.opacity = opacity;
            }
        } else {
            // 如果后端无数据，使用默认背景
            document.body.style.backgroundImage = `url('https://framagit.org/Falcon/Source/-/raw/main/background/Toomi_15.jpg?ref_type=heads')`;
        }
    } catch (error) {
        console.error('加载背景配置失败:', error);
        // 出错时也设置默认背景
        document.body.style.backgroundImage = `url('https://framagit.org/Falcon/Source/-/raw/main/background/Toomi_15.jpg?ref_type=heads')`;
    }
}
// ====== 结束 ======

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

        window.location.href = '/panel';
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

// 页面加载完成后加载背景
document.addEventListener('DOMContentLoaded', loadBackground);