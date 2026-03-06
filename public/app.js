// State
let globalConfig = null;

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
        fetchConfig();
        fetchStatus();
        setInterval(fetchStatus, 30000); // Auto refresh status every 30s
    }

    // Modal Handling
    document.querySelectorAll('.close-btn, .close-btn-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const modalId = btn.getAttribute('data-modal');
            document.getElementById(modalId).classList.remove('active');
        });
    });

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = '/login.html';
        });
    }
});

// --- Service Management ---
async function fetchStatus() {
    try {
        const res = await fetch('/api/service/status');
        if (res.status === 401) window.location.href = '/login.html';
        const data = await res.json();

        const indicator = document.getElementById('statusIndicator');
        const text = document.getElementById('statusText');
        const output = document.getElementById('terminalOutput');

        if (data.isRunning) {
            indicator.className = 'status-indicator status-online';
            text.textContent = '运行中';
        } else {
            indicator.className = 'status-indicator status-offline';
            text.textContent = '已停止';
        }

        if (data.output) {
            output.textContent = data.output;
            output.style.display = 'block';
        }
    } catch (e) {
        console.error('Failed to fetch status:', e);
    }
}

document.getElementById('restartBtn')?.addEventListener('click', async () => {
    document.getElementById('statusText').textContent = '正在重启...';
    try {
        const res = await fetch('/api/service/restart', { method: 'POST' });
        const data = await res.json();
        document.getElementById('terminalOutput').textContent = data.output || data.error;
        document.getElementById('terminalOutput').style.display = 'block';
        setTimeout(fetchStatus, 2000);
    } catch (e) {
        alert('操作失败');
    }
});

document.getElementById('stopBtn')?.addEventListener('click', async () => {
    if (!confirm('确定要停止服务吗？')) return;
    document.getElementById('statusText').textContent = '正在停止...';
    try {
        const res = await fetch('/api/service/stop', { method: 'POST' });
        const data = await res.json();
        document.getElementById('terminalOutput').textContent = data.output || data.error;
        document.getElementById('terminalOutput').style.display = 'block';
        setTimeout(fetchStatus, 2000);
    } catch (e) {
        alert('操作失败');
    }
});

// --- Config Management ---
async function fetchConfig() {
    try {
        const res = await fetch('/api/config');
        if (res.status === 401) window.location.href = '/login.html';
        globalConfig = await res.json();
        renderProviders();
        renderActiveModelSelect();
    } catch (e) {
        console.error('Failed to fetch config:', e);
    }
}

function renderActiveModelSelect() {
    const select = document.getElementById('activeModelSelect');
    if (!select) return;
    select.innerHTML = '';

    let optionsFound = false;

    if (globalConfig && globalConfig.providers) {
        Object.keys(globalConfig.providers).forEach(providerName => {
            const provider = globalConfig.providers[providerName];
            if (provider.models && provider.models.length > 0) {
                const optgroup = document.createElement('optgroup');
                optgroup.label = providerName;

                provider.models.forEach(model => {
                    const value = `${providerName}/${model.id}`;
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = model.name || model.id;
                    if (value === globalConfig.activeModel) {
                        option.selected = true;
                    }
                    optgroup.appendChild(option);
                    optionsFound = true;
                });

                select.appendChild(optgroup);
            }
        });
    }

    if (!optionsFound) {
        const option = document.createElement('option');
        option.textContent = '暂无可用模型，请先添加';
        option.disabled = true;
        select.appendChild(option);
    }
}

document.getElementById('saveActiveModelBtn')?.addEventListener('click', async () => {
    const select = document.getElementById('activeModelSelect');
    const modelStr = select.value;
    if (!modelStr) return;

    try {
        const res = await fetch('/api/active-model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modelStr })
        });
        if (res.ok) {
            alert('默认模型保存成功');
            fetchConfig();
        } else {
            alert('保存失败');
        }
    } catch (e) {
        alert('网络错误');
    }
});

// --- Providers Management ---
function renderProviders() {
    const list = document.getElementById('providersList');
    if (!list) return;
    list.innerHTML = '';

    if (!globalConfig.providers || Object.keys(globalConfig.providers).length === 0) {
        list.innerHTML = '<div class="empty-state">暂无渠道配置，请点击右上角添加</div>';
        return;
    }

    Object.keys(globalConfig.providers).forEach(providerName => {
        const provider = globalConfig.providers[providerName];

        const section = document.createElement('div');
        section.className = 'provider-section';

        // Header
        const header = document.createElement('div');
        header.className = 'provider-header';

        const titleContainer = document.createElement('div');
        titleContainer.className = 'provider-title';
        titleContainer.innerHTML = `
            ${providerName}
            <span class="badge badge-success">${provider.api}</span>
            <span class="text-muted ml-2">${provider.baseUrl}</span>
        `;

        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'actions-cell';

        const addModelBtn = document.createElement('button');
        addModelBtn.className = 'btn btn-secondary';
        addModelBtn.style.padding = '6px 12px';
        addModelBtn.textContent = '添加模型';
        addModelBtn.onclick = () => openModelModal(providerName);

        const delProviderBtn = document.createElement('button');
        delProviderBtn.className = 'btn btn-danger';
        delProviderBtn.style.padding = '6px 12px';
        delProviderBtn.textContent = '删除渠道';
        delProviderBtn.onclick = () => deleteProvider(providerName);

        actionsContainer.appendChild(addModelBtn);
        actionsContainer.appendChild(delProviderBtn);

        header.appendChild(titleContainer);
        header.appendChild(actionsContainer);
        section.appendChild(header);

        // Models Table
        if (provider.models && provider.models.length > 0) {
            const table = document.createElement('table');
            table.className = 'table';
            table.innerHTML = `
                <thead>
                    <tr>
                        <th>模型 ID</th>
                        <th>显示名称</th>
                        <th>上下文窗口</th>
                        <th>状态</th>
                        <th style="width: 100px;">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${provider.models.map(m => {
                        const isPrimary = globalConfig.activeModel === `${providerName}/${m.id}`;
                        return `
                        <tr>
                            <td>${m.id}</td>
                            <td>${m.name || m.id}</td>
                            <td>${m.contextWindow || '-'}</td>
                            <td>${isPrimary ? '<span class="badge badge-active">当前默认</span>' : ''}</td>
                            <td>
                                <button class="btn btn-danger" style="padding: 4px 8px; font-size: 12px;" onclick="deleteModel('${providerName}', '${m.id}')">删除</button>
                            </td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            `;
            section.appendChild(table);
        } else {
            const emptyMsg = document.createElement('div');
            emptyMsg.style.padding = '20px';
            emptyMsg.style.textAlign = 'center';
            emptyMsg.style.color = 'var(--text-muted)';
            emptyMsg.textContent = '该渠道下暂无模型';
            section.appendChild(emptyMsg);
        }

        list.appendChild(section);
    });
}

document.getElementById('addProviderBtn')?.addEventListener('click', () => {
    document.getElementById('providerForm').reset();
    document.getElementById('providerModal').classList.add('active');
});

document.getElementById('providerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        name: document.getElementById('providerName').value,
        baseUrl: document.getElementById('providerBaseUrl').value,
        apiKey: document.getElementById('providerApiKey').value,
        api: document.getElementById('providerApiType').value
    };

    try {
        const res = await fetch('/api/providers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            document.getElementById('providerModal').classList.remove('active');
            fetchConfig();
        } else {
            const err = await res.json();
            alert('添加失败: ' + err.error);
        }
    } catch (e) {
        alert('网络错误');
    }
});

async function deleteProvider(name) {
    if (!confirm(`确定要删除渠道 ${name} 吗？这将删除其下所有模型。`)) return;
    try {
        const res = await fetch(`/api/providers/${encodeURIComponent(name)}`, { method: 'DELETE' });
        if (res.ok) {
            fetchConfig();
        } else {
            alert('删除失败');
        }
    } catch (e) {
        alert('网络错误');
    }
}

// --- Model Management ---
function openModelModal(providerName) {
    document.getElementById('modelForm').reset();
    document.getElementById('modelProviderName').value = providerName;
    document.getElementById('modelModal').classList.add('active');
}

document.getElementById('modelForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const providerName = document.getElementById('modelProviderName').value;
    const data = {
        id: document.getElementById('modelId').value,
        name: document.getElementById('modelName').value,
        contextWindow: parseInt(document.getElementById('modelContextWindow').value, 10),
        maxTokens: parseInt(document.getElementById('modelMaxTokens').value, 10)
    };

    try {
        const res = await fetch(`/api/providers/${encodeURIComponent(providerName)}/models`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            document.getElementById('modelModal').classList.remove('active');
            fetchConfig();
        } else {
            const err = await res.json();
            alert('添加失败: ' + err.error);
        }
    } catch (e) {
        alert('网络错误');
    }
});

async function deleteModel(providerName, modelId) {
    if (!confirm(`确定要删除模型 ${modelId} 吗？`)) return;
    try {
        const res = await fetch(`/api/providers/${encodeURIComponent(providerName)}/models/${encodeURIComponent(modelId)}`, { method: 'DELETE' });
        if (res.ok) {
            fetchConfig();
        } else {
            alert('删除失败');
        }
    } catch (e) {
        alert('网络错误');
    }
}
