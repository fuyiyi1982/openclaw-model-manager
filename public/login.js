document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loginForm');
    const errorMsg = document.getElementById('errorMsg');
    const passwordInput = document.getElementById('password');

    if (!form || !errorMsg || !passwordInput) {
        return;
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorMsg.style.display = 'none';

        const password = passwordInput.value;
        if (!password) {
            errorMsg.textContent = '请输入密码';
            errorMsg.style.display = 'block';
            return;
        }

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ password })
            });

            if (response.ok) {
                window.location.href = '/';
                return;
            }

            let message = '登录失败';
            try {
                const data = await response.json();
                if (data && data.error) {
                    message = data.error;
                }
            } catch (_) {}

            errorMsg.textContent = message;
            errorMsg.style.display = 'block';
        } catch (_) {
            errorMsg.textContent = '网络错误';
            errorMsg.style.display = 'block';
        }
    });
});
