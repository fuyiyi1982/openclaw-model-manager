let globalConfig = { providers: {}, activeModel: '' };
let statusTimer = null;

function $(id) {
    return document.getElementById(id);
}

function showModal(modalId) {
    $(modalId)?.classList.add('active');
}

function hideModal(modalId) {
    $(modalId)?.classList.remove('active');
}

function setText(id, value) {
    const element = $(id);
    if (element) {
        element.textContent = value;
    }
}

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text !== undefined) {
        element.textContent = text;
    }
    return element;
}

async function readErrorMessage(res, fallback = '请求失败') {
    try {
        const data = await res.clone().json();
        if (data && data.error) {
            return data.error;
        }
    } catch (_) {
        try {
            const text = await res.clone().text();
            if (text && text.trim()) {
                return `${fallback} (HTTP ${res.status})`;
            }
        } catch (__){}
    }

    return `${fallback} (HTTP ${res.status})`;
}

async function apiFetch(url, options = {}) {
    const res = await fetch(url, {
        credentials: 'same-origin',
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    if (res.status === 401) {
        window.location.href = '/login.html';
        throw new Error('Unauthorized');
    }

    return res;
}

function setTerminalOutput(message) {
    const output = $('terminalOutput');
    if (!output) {
        return;
    }

    const text = typeof message === 'string' ? message.trim() : '';
    output.textContent = text;
    output.style.display = text ? 'block' : 'none';
}

function buildProviderSummary(providerName, provider) {
    const wrapper = createElement('div', 'provider-title');
    wrapper.append(document.createTextNode(providerName));

    const apiBadge = createElement('span', 'badge badge-success', provider.api || 'unknown');
    wrapper.appendChild(apiBadge);

    const urlText = createElement('span', 'text-muted', provider.baseUrl || '');
    wrapper.appendChild(urlText);

    if (provider.hasApiKey) {
        wrapper.appendChild(createElement('span', 'badge badge-neutral', '已配置密钥'));
    }

    return wrapper;
}

function createButton(label, className, onClick) {
    const button = createElement('button', className, label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    return button;
}

function createModelRow(providerName, model) {
    const tr = document.createElement('tr');
    const isPrimary = globalConfig.activeModel === `${providerName}/${model.id}`;

    const idCell = createElement('td', '', model.id);
    const nameCell = createElement('td', '', model.name || model.id);
    const contextCell = createElement('td', '', String(model.contextWindow || '-'));

    const statusCell = createElement('td');
    if (isPrimary) {
        statusCell.appendChild(createElement('span', 'badge badge-active', '当前默认'));
    }

    const actionsCell = createElement('td', 'actions-cell actions-cell-compact');
    actionsCell.appendChild(
        createButton('编辑', 'btn btn-secondary btn-small', () => {
            openEditModelModal(providerName, model);
        })
    );
    actionsCell.appendChild(
        createButton('删除', 'btn btn-danger btn-small', (event) => {
            deleteModel(event, providerName, model.id);
        })
    );

    tr.appendChild(idCell);
    tr.appendChild(nameCell);
    tr.appendChild(contextCell);
    tr.appendChild(statusCell);
    tr.appendChild(actionsCell);

    return tr;
}

function renderProviders() {
    const list = $('providersList');
    if (!list) {
        return;
    }

    list.replaceChildren();

    const providers = globalConfig.providers || {};
    const providerEntries = Object.entries(providers);

    if (providerEntries.length === 0) {
        list.appendChild(createElement('div', 'empty-state', '暂无渠道配置，请点击右上角添加'));
        return;
    }

    providerEntries.forEach(([providerName, provider]) => {
        const section = createElement('div', 'provider-section');
        const header = createElement('div', 'provider-header');
        const actions = createElement('div', 'actions-cell');

        const editProviderBtn = createButton('编辑渠道', 'btn btn-secondary', () => {
            openEditProviderModal(providerName, provider);
        });
        const addModelBtn = createButton('添加模型', 'btn btn-secondary', () => {
            openModelModal(providerName);
        });
        const deleteProviderBtn = createButton('删除渠道', 'btn btn-danger', (event) => {
            deleteProvider(event, providerName);
        });

        actions.appendChild(editProviderBtn);
        actions.appendChild(addModelBtn);
        actions.appendChild(deleteProviderBtn);

        header.appendChild(buildProviderSummary(providerName, provider));
        header.appendChild(actions);
        section.appendChild(header);

        if (Array.isArray(provider.models) && provider.models.length > 0) {
            const table = createElement('table', 'table');
            const thead = document.createElement('thead');
            const headRow = document.createElement('tr');
            ['模型 ID', '显示名称', '上下文窗口', '状态', '操作'].forEach((title) => {
                headRow.appendChild(createElement('th', '', title));
            });
            thead.appendChild(headRow);

            const tbody = document.createElement('tbody');
            provider.models.forEach((model) => {
                tbody.appendChild(createModelRow(providerName, model));
            });

            table.appendChild(thead);
            table.appendChild(tbody);
            section.appendChild(table);
        } else {
            section.appendChild(createElement('div', 'provider-empty', '该渠道下暂无模型'));
        }

        list.appendChild(section);
    });
}

function renderActiveModelSelect() {
    const select = $('activeModelSelect');
    if (!select) {
        return;
    }

    select.replaceChildren();

    let hasOptions = false;
    Object.entries(globalConfig.providers || {}).forEach(([providerName, provider]) => {
        const models = Array.isArray(provider.models) ? provider.models : [];
        if (models.length === 0) {
            return;
        }

        const group = document.createElement('optgroup');
        group.label = providerName;

        models.forEach((model) => {
            const option = document.createElement('option');
            option.value = `${providerName}/${model.id}`;
            option.textContent = model.name || model.id;
            option.selected = option.value === globalConfig.activeModel;
            group.appendChild(option);
            hasOptions = true;
        });

        select.appendChild(group);
    });

    if (!hasOptions) {
        const option = document.createElement('option');
        option.textContent = '暂无可用模型，请先添加';
        option.disabled = true;
        option.selected = true;
        select.appendChild(option);
    }
}

async function fetchConfig() {
    try {
        const res = await apiFetch('/api/config', { headers: {} });
        if (!res.ok) {
            throw new Error(await readErrorMessage(res, '读取配置失败'));
        }
        globalConfig = await res.json();
        renderProviders();
        renderActiveModelSelect();
    } catch (error) {
        if (error.message !== 'Unauthorized') {
            console.error('Failed to fetch config:', error);
        }
    }
}

async function fetchStatus() {
    try {
        const res = await apiFetch('/api/service/status', { headers: {} });
        if (!res.ok) {
            throw new Error(await readErrorMessage(res, '读取服务状态失败'));
        }
        const data = await res.json();
        const indicator = $('statusIndicator');
        const text = $('statusText');

        if (indicator && text) {
            indicator.className = `status-indicator ${data.isRunning ? 'status-online' : 'status-offline'}`;
            text.textContent = data.isRunning ? '运行中' : '已停止';
        }

        setTerminalOutput(data.output);
    } catch (error) {
        if (error.message !== 'Unauthorized') {
            console.error('Failed to fetch status:', error);
        }
    }
}

function startStatusPolling() {
    if (statusTimer || !$('statusText')) {
        return;
    }

    fetchStatus();
    statusTimer = window.setInterval(fetchStatus, 30000);
}

function stopStatusPolling() {
    if (statusTimer) {
        window.clearInterval(statusTimer);
        statusTimer = null;
    }
}

async function submitJson(url, method, data) {
    return apiFetch(url, {
        method,
        body: JSON.stringify(data)
    });
}

function openModelModal(providerName) {
    $('modelForm')?.reset();
    $('editOldModelId').value = '';
    $('modelProviderName').value = providerName;
    setText('modelModalTitle', '添加模型');
    showModal('modelModal');
}

function openEditModelModal(providerName, model) {
    $('modelForm')?.reset();
    $('modelProviderName').value = providerName;
    $('editOldModelId').value = model.id;
    $('modelId').value = model.id;
    $('modelName').value = model.name || model.id;
    $('modelContextWindow').value = model.contextWindow || 128000;
    $('modelMaxTokens').value = model.maxTokens || 4096;
    setText('modelModalTitle', '编辑模型');
    showModal('modelModal');
}

function openEditProviderModal(name, provider) {
    $('providerForm')?.reset();
    $('editOldProviderName').value = name;
    $('providerName').value = name;
    $('providerBaseUrl').value = provider.baseUrl || '';
    $('providerApiKey').value = '';
    $('providerApiType').value = provider.api || 'openai-completions';
    $('providerApiKey').placeholder = provider.hasApiKey ? '留空则保持当前 API Key' : '请输入 API Key';
    $('providerApiKey').required = false;
    setText('providerModalTitle', '编辑渠道');
    showModal('providerModal');
}

async function deleteProvider(event, name) {
    event?.preventDefault();
    event?.stopPropagation();

    if (!window.confirm(`确定要删除渠道 ${name} 吗？这将删除其下所有模型。`)) {
        return;
    }

    try {
        const res = await apiFetch(`/api/providers/${encodeURIComponent(name)}`, {
            method: 'DELETE',
            headers: {}
        });
        if (!res.ok) {
            throw new Error(await readErrorMessage(res, '删除失败'));
        }

        await fetchConfig();
        window.alert('删除成功');
    } catch (error) {
        window.alert(error.message || '网络错误');
    }
}

async function deleteModel(event, providerName, modelId) {
    event?.preventDefault();
    event?.stopPropagation();

    if (!window.confirm(`确定要删除模型 ${modelId} 吗？`)) {
        return;
    }

    try {
        const res = await apiFetch(
            `/api/providers/${encodeURIComponent(providerName)}/models/${encodeURIComponent(modelId)}`,
            { method: 'DELETE', headers: {} }
        );
        if (!res.ok) {
            throw new Error(await readErrorMessage(res, '删除失败'));
        }

        await fetchConfig();
        window.alert('删除成功');
    } catch (error) {
        window.alert(error.message || '网络错误');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.close-btn, .close-btn-action').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            hideModal(button.dataset.modal);
        });
    });

    $('logoutBtn')?.addEventListener('click', async (event) => {
        event.preventDefault();
        try {
            await apiFetch('/api/logout', { method: 'POST', headers: {} });
        } finally {
            window.location.href = '/login.html';
        }
    });

    $('addProviderBtn')?.addEventListener('click', () => {
        $('providerForm')?.reset();
        $('editOldProviderName').value = '';
        $('providerApiKey').required = true;
        $('providerApiKey').placeholder = '';
        setText('providerModalTitle', '添加渠道');
        showModal('providerModal');
    });

    $('providerForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();

        const oldName = $('editOldProviderName').value.trim();
        const isEdit = Boolean(oldName);
        const payload = {
            name: $('providerName').value.trim(),
            baseUrl: $('providerBaseUrl').value.trim(),
            apiKey: $('providerApiKey').value.trim(),
            api: $('providerApiType').value
        };

        if (!isEdit && !payload.apiKey) {
            window.alert('API Key 不能为空');
            return;
        }

        try {
            const res = await submitJson(
                isEdit ? `/api/providers/${encodeURIComponent(oldName)}` : '/api/providers',
                isEdit ? 'PUT' : 'POST',
                payload
            );
            if (!res.ok) {
                throw new Error(await readErrorMessage(res, isEdit ? '更新失败' : '添加失败'));
            }

            hideModal('providerModal');
            await fetchConfig();
            window.alert(isEdit ? '渠道更新成功' : '渠道添加成功');
        } catch (error) {
            window.alert(error.message || '网络错误');
        }
    });

    $('modelForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();

        const providerName = $('modelProviderName').value;
        const oldModelId = $('editOldModelId').value.trim();
        const isEdit = Boolean(oldModelId);
        const payload = {
            id: $('modelId').value.trim(),
            name: $('modelName').value.trim(),
            contextWindow: $('modelContextWindow').value,
            maxTokens: $('modelMaxTokens').value
        };

        try {
            const res = await submitJson(
                isEdit
                    ? `/api/providers/${encodeURIComponent(providerName)}/models/${encodeURIComponent(oldModelId)}`
                    : `/api/providers/${encodeURIComponent(providerName)}/models`,
                isEdit ? 'PUT' : 'POST',
                payload
            );
            if (!res.ok) {
                throw new Error(await readErrorMessage(res, '保存失败'));
            }

            hideModal('modelModal');
            await fetchConfig();
            window.alert(isEdit ? '模型更新成功' : '模型添加成功');
        } catch (error) {
            window.alert(error.message || '网络错误');
        }
    });

    $('saveActiveModelBtn')?.addEventListener('click', async () => {
        const modelStr = $('activeModelSelect')?.value;
        if (!modelStr) {
            return;
        }

        try {
            const res = await submitJson('/api/active-model', 'POST', { modelStr });
            if (!res.ok) {
                throw new Error(await readErrorMessage(res, '保存失败'));
            }

            window.alert('默认模型保存成功');
            await fetchConfig();
        } catch (error) {
            window.alert(error.message || '网络错误');
        }
    });

    $('restartBtn')?.addEventListener('click', async () => {
        setText('statusText', '正在重启...');
        try {
            const res = await apiFetch('/api/service/restart', { method: 'POST', headers: {} });
            if (!res.ok) {
                throw new Error(await readErrorMessage(res, '重启失败'));
            }
            const data = await res.json();
            setTerminalOutput(data.output || data.error);
            window.setTimeout(fetchStatus, 2000);
        } catch (error) {
            window.alert(error.message || '操作失败');
            await fetchStatus();
        }
    });

    $('stopBtn')?.addEventListener('click', async () => {
        if (!window.confirm('确定要停止服务吗？')) {
            return;
        }

        setText('statusText', '正在停止...');
        try {
            const res = await apiFetch('/api/service/stop', { method: 'POST', headers: {} });
            if (!res.ok) {
                throw new Error(await readErrorMessage(res, '停止失败'));
            }
            const data = await res.json();
            setTerminalOutput(data.output || data.error);
            window.setTimeout(fetchStatus, 2000);
        } catch (error) {
            window.alert(error.message || '操作失败');
            await fetchStatus();
        }
    });

    if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
        fetchConfig();
        startStatusPolling();
    } else {
        stopStatusPolling();
    }
});
