document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('passwordForm');
    const msg = document.getElementById('msg');

    if (!form || !msg) {
        return;
    }

    function showMessage(text, isSuccess) {
        msg.textContent = text;
        msg.style.color = isSuccess ? 'var(--success-color)' : 'var(--danger-color)';
        msg.style.display = 'block';
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const currentPassword = document.getElementById('currentPassword')?.value || '';
        const newPassword = document.getElementById('newPassword')?.value || '';
        const confirmPassword = document.getElementById('confirmPassword')?.value || '';

        if (newPassword.length < 8) {
            showMessage('新密码长度至少为 8 位', false);
            return;
        }

        if (newPassword !== confirmPassword) {
            showMessage('两次输入的新密码不一致', false);
            return;
        }

        try {
            const response = await fetch('/api/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ currentPassword, newPassword })
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                showMessage(data.error || '修改失败', false);
                return;
            }

            form.reset();
            showMessage('密码修改成功，请重新登录', true);
            window.setTimeout(() => {
                window.location.href = '/login.html';
            }, 1500);
        } catch (_) {
            showMessage('网络错误', false);
        }
    });
});
