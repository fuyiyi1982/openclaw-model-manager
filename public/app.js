// State
let globalConfig = null;

async function readErrorMessage(res, fallback = '请求失败') {
    const cloned = res.clone();
    try {
        const data = await res.json();
        if (data && data.error) return data.error;
    } catch (_) {
        try {
            const text = await cloned.text();
            if (text && text.trim()) return `${fallback} (HTTP ${res.status})`;
        } catch (__){ }
    }
    return `${fallback} (HTTP ${res.status})`;
}

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
            alert('保存失败: ' + await readErrorMessage(res, '保存失败'));
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
        addModelBtn.type = 'button';
        addModelBtn.className = 'btn btn-secondary';
        addModelBtn.style.padding = '6px 12px';
        addModelBtn.textContent = '添加模型';
        addModelBtn.onclick = () => openModelModal(providerName);

        const editProviderBtn = document.createElement('button');
        editProviderBtn.type = 'button';
        editProviderBtn.className = 'btn btn-secondary';
        editProviderBtn.style.padding = '6px 12px';
        editProviderBtn.style.marginRight = '8px';
        editProviderBtn.textContent = '编辑渠道';
        editProviderBtn.onclick = () => openEditProviderModal(providerName, provider);
        actionsContainer.appendChild(editProviderBtn);
        const delProviderBtn = document.createElement('button');
        delProviderBtn.type = 'button';
        delProviderBtn.className = 'btn btn-danger';
        delProviderBtn.style.padding = '6px 12px';
        delProviderBtn.textContent = '删除渠道';
        delProviderBtn.onclick = (event) => deleteProvider(event, providerName);

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
                                <button type="button" class="btn btn-secondary" style="padding: 4px 8px; font-size: 12px; margin-right: 4px;" onclick="openEditModelModal('${providerName}', '${m.id}', '${m.name || ''}', ${m.contextWindow || 128000}, ${m.maxTokens || 4096})">编辑</button>
                                <button type="button" class="btn btn-danger" style="padding: 4px 8px; font-size: 12px;" onclick="deleteModel(event, '${providerName}', '${m.id}')">删除</button>
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
    document.getElementById('editOldProviderName').value = '';
    document.getElementById('providerModalTitle').textContent = '添加渠道';
    document.getElementById('providerModal').classList.add('active');
});

document.getElementById('providerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldName = document.getElementById('editOldProviderName').value;
    const isEdit = !!oldName;
    
    const data = {
        name: document.getElementById('providerName').value,
        baseUrl: document.getElementById('providerBaseUrl').value,
        apiKey: document.getElementById('providerApiKey').value,
        api: document.getElementById('providerApiType').value
    };

    try {
        const url = isEdit ? '/api/providers/' + encodeURIComponent(oldName) : '/api/providers';
        const method = isEdit ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            document.getElementById('providerModal').classList.remove('active');
            fetchConfig();
            alert(isEdit ? '渠道更新成功' : '渠道添加成功');
        } else {
            alert('添加失败: ' + await readErrorMessage(res, '添加失败'));
        }
    } catch (e) {
        alert('网络错误');
    }
});

async function deleteProvider(event, name) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    if (!confirm(`确定要删除渠道 ${name} 吗？这将删除其下所有模型。`)) return;
    try {
        const res = await fetch(`/api/providers/${encodeURIComponent(name)}`, { method: 'DELETE' });
        if (res.ok) {
            fetchConfig();
            alert('删除成功');
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
    document.getElementById('editOldModelId').value = '';
    document.getElementById('modelModalTitle').textContent = '添加模型';
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

    const oldModelId = document.getElementById('editOldModelId').value;
    const isEdit = !!oldModelId;
    const url = isEdit ? `/api/providers/${encodeURIComponent(providerName)}/models/${encodeURIComponent(oldModelId)}` : `/api/providers/${encodeURIComponent(providerName)}/models`;
    const method = isEdit ? 'PUT' : 'POST';
    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            document.getElementById('modelModal').classList.remove('active');
            fetchConfig();
            alert(isEdit ? '模型更新成功' : '模型添加成功');
        } else {
            alert('操作失败: ' + await readErrorMessage(res, '操作失败'));
        }
    } catch (e) {
        alert('网络错误');
    }
});

async function deleteModel(event, providerName, modelId) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    if (!confirm(`确定要删除模型 ${modelId} 吗？`)) return;
    try {
        const res = await fetch(`/api/providers/${encodeURIComponent(providerName)}/models/${encodeURIComponent(modelId)}`, { method: 'DELETE' });
        if (res.ok) {
            fetchConfig();
            alert('删除成功');
        } else {
            alert('删除失败');
        }
    } catch (e) {
        alert('网络错误');
    }
}


// --- EDIT FUNCTIONS ---
function openEditProviderModal(name, provider) {
    document.getElementById('providerForm').reset();
    document.getElementById('editOldProviderName').value = '';
    document.getElementById('providerModalTitle').textContent = '添加渠道';
    document.getElementById('editOldProviderName').value = name;
    document.getElementById('providerName').value = name;
    document.getElementById('providerBaseUrl').value = provider.baseUrl || '';
    document.getElementById('providerApiKey').value = provider.apiKey || '';
    document.getElementById('providerApiType').value = provider.api || 'openai-completions';
    
    document.getElementById('providerModalTitle').textContent = '编辑渠道';
    document.getElementById('providerModal').classList.add('active');
}

function openEditModelModal(providerName, id, name, contextWindow, maxTokens) {
    document.getElementById('modelForm').reset();
    document.getElementById('editOldModelId').value = '';
    document.getElementById('modelModalTitle').textContent = '添加模型';
    document.getElementById('modelProviderName').value = providerName;
    document.getElementById('editOldModelId').value = id;
    
    document.getElementById('modelId').value = id;
    document.getElementById('modelName').value = name || id;
    document.getElementById('modelContextWindow').value = contextWindow;
    document.getElementById('modelMaxTokens').value = maxTokens;
    
    document.getElementById('modelModalTitle').textContent = '编辑模型';
    document.getElementById('modelModal').classList.add('active');
}
