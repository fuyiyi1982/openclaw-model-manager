const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const app = express();
const execFileAsync = promisify(execFile);

const PORT = Number.parseInt(process.env.PORT || '1109', 10);
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_SECRET =
    process.env.SESSION_SECRET || crypto.createHash('sha256').update(__dirname).digest('hex');
const PANEL_CONFIG_PATH = path.join(__dirname, 'panel-config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const VALID_PROVIDER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const VALID_MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const VALID_API_TYPES = new Set(['openai-completions', 'anthropic-messages']);

const loginAttempts = new Map();

function ensurePanelConfig() {
    if (fs.existsSync(PANEL_CONFIG_PATH)) {
        return;
    }

    const hash = bcrypt.hashSync('admin123', 10);
    fs.writeFileSync(PANEL_CONFIG_PATH, JSON.stringify({ passwordHash: hash }, null, 2));
}

ensurePanelConfig();

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(
    session({
        name: 'openclaw.sid',
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: false,
            maxAge: 24 * 60 * 60 * 1000
        }
    })
);

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    next();
});

function isAuthenticated(req) {
    return Boolean(req.session && req.session.authenticated);
}

function requireAuth(req, res, next) {
    if (isAuthenticated(req)) {
        return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
}

function requirePageAuth(req, res, next) {
    if (isAuthenticated(req)) {
        return next();
    }
    return res.redirect('/login.html');
}

function getClientKey(req) {
    return req.ip || req.socket.remoteAddress || 'unknown';
}

function isRateLimited(req) {
    const key = getClientKey(req);
    const now = Date.now();
    const record = loginAttempts.get(key);

    if (!record) {
        return false;
    }

    if (now > record.resetAt) {
        loginAttempts.delete(key);
        return false;
    }

    return record.count >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedLogin(req) {
    const key = getClientKey(req);
    const now = Date.now();
    const current = loginAttempts.get(key);

    if (!current || now > current.resetAt) {
        loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
        return;
    }

    current.count += 1;
}

function clearFailedLogins(req) {
    loginAttempts.delete(getClientKey(req));
}

async function readPanelConfig() {
    const raw = await fsp.readFile(PANEL_CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
}

async function writePanelConfig(config) {
    await fsp.writeFile(PANEL_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

async function runManageConfig(action, input) {
    const options = {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024
    };

    if (input !== undefined) {
        options.input = input;
    }

    const { stdout, stderr } = await execFileAsync(
        'sudo',
        ['/usr/local/bin/manage-openclaw-config.sh', action],
        options
    );

    return (stdout || stderr || '').trim();
}

function tryParseJson(value) {
    if (!value) {
        return null;
    }

    try {
        return JSON.parse(value);
    } catch (_) {
        return null;
    }
}

async function readOpenclawConfig() {
    const output = await runManageConfig('read');
    if (!output) {
        throw new Error('无法读取 OpenClaw 配置文件内容');
    }

    return JSON.parse(output);
}

async function writeOpenclawConfig(config) {
    await runManageConfig('write', JSON.stringify(config, null, 2));
}

function sanitizeProviderForClient(provider) {
    return {
        baseUrl: provider.baseUrl || '',
        api: provider.api || '',
        hasApiKey: Boolean(provider.apiKey),
        models: Array.isArray(provider.models) ? provider.models : []
    };
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}

function validateProviderPayload(body, { isEdit = false } = {}) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const api = typeof body.api === 'string' ? body.api.trim() : '';

    if (!VALID_PROVIDER_NAME.test(name)) {
        return { error: '渠道名称格式不合法，只允许字母、数字、点、下划线和中划线' };
    }

    try {
        const parsedUrl = new URL(baseUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            return { error: 'Base URL 必须使用 http 或 https 协议' };
        }
    } catch (_) {
        return { error: 'Base URL 格式不合法' };
    }

    if (!VALID_API_TYPES.has(api)) {
        return { error: 'API 类型不受支持' };
    }

    if (!isEdit && !apiKey) {
        return { error: 'API Key 不能为空' };
    }

    return {
        value: {
            name,
            baseUrl,
            api,
            apiKey
        }
    };
}

function normalizePositiveInteger(value, fallback, fieldName) {
    if (value === undefined || value === null || value === '') {
        return { value: fallback };
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return { error: `${fieldName} 必须是正整数` };
    }

    return { value: parsed };
}

function validateModelPayload(body) {
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';

    if (!VALID_MODEL_ID.test(id)) {
        return { error: '模型 ID 格式不合法' };
    }

    const contextWindow = normalizePositiveInteger(body.contextWindow, 128000, '上下文窗口');
    if (contextWindow.error) {
        return contextWindow;
    }

    const maxTokens = normalizePositiveInteger(body.maxTokens, 4096, '最大输出 Token');
    if (maxTokens.error) {
        return maxTokens;
    }

    return {
        value: {
            id,
            name: name || id,
            reasoning: Boolean(body.reasoning),
            input: Array.isArray(body.input) && body.input.length > 0 ? body.input : ['text'],
            cost: body.cost && typeof body.cost === 'object'
                ? body.cost
                : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: contextWindow.value,
            maxTokens: maxTokens.value
        }
    };
}

function ensureAgentDefaults(config) {
    if (!config.agents) {
        config.agents = {};
    }
    if (!config.agents.defaults) {
        config.agents.defaults = {};
    }
    if (!config.agents.defaults.model) {
        config.agents.defaults.model = {};
    }
}

function clearActiveModelIfMissing(config) {
    const activeModel = config.agents?.defaults?.model?.primary;
    if (!activeModel) {
        return;
    }

    const [providerName, ...modelParts] = activeModel.split('/');
    const modelId = modelParts.join('/');
    const provider = config.models?.providers?.[providerName];
    const modelExists = Array.isArray(provider?.models) && provider.models.some((model) => model.id === modelId);

    if (!modelExists) {
        ensureAgentDefaults(config);
        delete config.agents.defaults.model.primary;
    }
}

function serializeServiceOutput(stdout, stderr, error) {
    return (stdout || stderr || (error ? error.message : '') || '没有输出').trim();
}

async function runServiceCommand(action) {
    try {
        const { stdout, stderr } = await execFileAsync(
            'sudo',
            ['/usr/local/bin/manage-openclaw-service.sh', action],
            { encoding: 'utf8', maxBuffer: 1024 * 1024 }
        );
        const rawOutput = serializeServiceOutput(stdout, stderr);
        const parsed = tryParseJson(rawOutput);

        if (parsed && typeof parsed === 'object') {
            return {
                success: parsed.success !== false,
                output: typeof parsed.output === 'string' ? parsed.output : rawOutput,
                active: typeof parsed.active === 'string' ? parsed.active : 'unknown',
                subState: typeof parsed.subState === 'string' ? parsed.subState : 'unknown',
                enabled: typeof parsed.enabled === 'string' ? parsed.enabled : 'unknown',
                scope: typeof parsed.scope === 'string' ? parsed.scope : '',
                unit: typeof parsed.unit === 'string' ? parsed.unit : '',
                serviceFile: typeof parsed.serviceFile === 'string' ? parsed.serviceFile : '',
                error: typeof parsed.error === 'string' ? parsed.error : ''
            };
        }

        return { success: true, output: rawOutput, active: 'unknown', subState: 'unknown', enabled: 'unknown' };
    } catch (error) {
        const rawOutput = serializeServiceOutput(error.stdout, error.stderr, error);
        const parsed = tryParseJson(rawOutput);

        if (parsed && typeof parsed === 'object') {
            return {
                success: parsed.success === true,
                output: typeof parsed.output === 'string' ? parsed.output : rawOutput,
                active: typeof parsed.active === 'string' ? parsed.active : 'unknown',
                subState: typeof parsed.subState === 'string' ? parsed.subState : 'unknown',
                enabled: typeof parsed.enabled === 'string' ? parsed.enabled : 'unknown',
                scope: typeof parsed.scope === 'string' ? parsed.scope : '',
                unit: typeof parsed.unit === 'string' ? parsed.unit : '',
                serviceFile: typeof parsed.serviceFile === 'string' ? parsed.serviceFile : '',
                error: typeof parsed.error === 'string' ? parsed.error : error.message
            };
        }

        return {
            success: false,
            output: rawOutput,
            active: 'unknown',
            subState: 'unknown',
            enabled: 'unknown',
            error: error.message
        };
    }
}

app.get('/api/auth/status', (req, res) => {
    res.json({ authenticated: isAuthenticated(req) });
});

app.post('/api/login', async (req, res) => {
    if (isRateLimited(req)) {
        return res.status(429).json({ error: '登录尝试过于频繁，请 15 分钟后再试' });
    }

    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!password) {
        return res.status(400).json({ error: '密码不能为空' });
    }

    try {
        const config = await readPanelConfig();
        const matched = await bcrypt.compare(password, config.passwordHash);

        if (!matched) {
            recordFailedLogin(req);
            return res.status(401).json({ error: '密码错误' });
        }

        clearFailedLogins(req);
        req.session.authenticated = true;
        return req.session.save((saveError) => {
            if (saveError) {
                return res.status(500).json({ error: '登录状态保存失败' });
            }
            return res.json({ success: true });
        });
    } catch (error) {
        return res.status(500).json({ error: '读取配置失败' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('openclaw.sid');
        res.json({ success: true });
    });
});

app.post('/api/change-password', requireAuth, async (req, res) => {
    const currentPassword = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';

    if (newPassword.length < 8) {
        return res.status(400).json({ error: '新密码长度至少为 8 位' });
    }

    try {
        const config = await readPanelConfig();
        const matched = await bcrypt.compare(currentPassword, config.passwordHash);

        if (!matched) {
            return res.status(400).json({ error: '当前密码错误' });
        }

        config.passwordHash = await bcrypt.hash(newPassword, 10);
        await writePanelConfig(config);

        return req.session.destroy(() => {
            res.clearCookie('openclaw.sid');
            res.json({ success: true });
        });
    } catch (error) {
        return res.status(500).json({ error: '修改失败' });
    }
});

app.get('/api/config', requireAuth, async (req, res) => {
    try {
        const config = await readOpenclawConfig();
        const providers = Object.fromEntries(
            Object.entries(config.models?.providers || {}).map(([name, provider]) => [
                name,
                sanitizeProviderForClient(provider)
            ])
        );
        const activeModel = config.agents?.defaults?.model?.primary || '';

        return res.json({ providers, activeModel });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/providers', requireAuth, async (req, res) => {
    const validation = validateProviderPayload(req.body);
    if (validation.error) {
        return res.status(400).json({ error: validation.error });
    }

    const { name, baseUrl, apiKey, api } = validation.value;

    try {
        const config = await readOpenclawConfig();
        if (!config.models) {
            config.models = {};
        }
        if (!config.models.providers) {
            config.models.providers = {};
        }
        if (config.models.providers[name]) {
            return res.status(409).json({ error: '渠道已存在' });
        }

        config.models.providers[name] = { baseUrl, apiKey, api, models: [] };
        await writeOpenclawConfig(config);

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.put('/api/providers/:oldName', requireAuth, async (req, res) => {
    const oldName = String(req.params.oldName || '').trim();
    const validation = validateProviderPayload(req.body, { isEdit: true });
    if (validation.error) {
        return res.status(400).json({ error: validation.error });
    }

    const { name, baseUrl, apiKey, api } = validation.value;

    try {
        const config = await readOpenclawConfig();
        const providers = config.models?.providers;
        if (!providers || !providers[oldName]) {
            return res.status(404).json({ error: '找不到提供商' });
        }

        if (name !== oldName && providers[name]) {
            return res.status(409).json({ error: '目标渠道名称已存在' });
        }

        const providerData = {
            ...providers[oldName],
            baseUrl,
            api,
            models: Array.isArray(providers[oldName].models) ? providers[oldName].models : []
        };

        if (apiKey) {
            providerData.apiKey = apiKey;
        }

        if (name !== oldName) {
            delete providers[oldName];
        }
        providers[name] = providerData;

        const activeModel = config.agents?.defaults?.model?.primary;
        if (activeModel && activeModel.startsWith(`${oldName}/`)) {
            ensureAgentDefaults(config);
            config.agents.defaults.model.primary = activeModel.replace(`${oldName}/`, `${name}/`);
        }

        await writeOpenclawConfig(config);
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.delete('/api/providers/:name', requireAuth, async (req, res) => {
    const name = String(req.params.name || '').trim();

    try {
        const config = await readOpenclawConfig();
        const providers = config.models?.providers;
        if (!providers || !providers[name]) {
            return res.status(404).json({ error: '找不到提供商' });
        }

        delete providers[name];
        clearActiveModelIfMissing(config);
        await writeOpenclawConfig(config);

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/providers/:providerName/models', requireAuth, async (req, res) => {
    const providerName = String(req.params.providerName || '').trim();
    const validation = validateModelPayload(req.body);
    if (validation.error) {
        return res.status(400).json({ error: validation.error });
    }

    try {
        const config = await readOpenclawConfig();
        const provider = config.models?.providers?.[providerName];
        if (!provider) {
            return res.status(404).json({ error: '找不到提供商' });
        }

        if (!Array.isArray(provider.models)) {
            provider.models = [];
        }

        if (provider.models.some((model) => model.id === validation.value.id)) {
            return res.status(409).json({ error: '模型 ID 已存在' });
        }

        provider.models.push(validation.value);
        await writeOpenclawConfig(config);

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.put('/api/providers/:providerName/models/:oldModelId', requireAuth, async (req, res) => {
    const providerName = String(req.params.providerName || '').trim();
    const oldModelId = String(req.params.oldModelId || '').trim();
    const validation = validateModelPayload(req.body);
    if (validation.error) {
        return res.status(400).json({ error: validation.error });
    }

    try {
        const config = await readOpenclawConfig();
        const provider = config.models?.providers?.[providerName];
        if (!provider) {
            return res.status(404).json({ error: '找不到提供商' });
        }

        const models = Array.isArray(provider.models) ? provider.models : [];
        const modelIndex = models.findIndex((model) => model.id === oldModelId);
        if (modelIndex === -1) {
            return res.status(404).json({ error: '找不到模型' });
        }

        if (
            validation.value.id !== oldModelId &&
            models.some((model, index) => index !== modelIndex && model.id === validation.value.id)
        ) {
            return res.status(409).json({ error: '目标模型 ID 已存在' });
        }

        models[modelIndex] = {
            ...models[modelIndex],
            ...validation.value
        };

        const activeModel = config.agents?.defaults?.model?.primary;
        if (activeModel === `${providerName}/${oldModelId}`) {
            ensureAgentDefaults(config);
            config.agents.defaults.model.primary = `${providerName}/${validation.value.id}`;
        }

        await writeOpenclawConfig(config);
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.delete('/api/providers/:providerName/models/:modelId', requireAuth, async (req, res) => {
    const providerName = String(req.params.providerName || '').trim();
    const modelId = String(req.params.modelId || '').trim();

    try {
        const config = await readOpenclawConfig();
        const provider = config.models?.providers?.[providerName];
        if (!provider) {
            return res.status(404).json({ error: '找不到提供商' });
        }

        const models = Array.isArray(provider.models) ? provider.models : [];
        const nextModels = models.filter((model) => model.id !== modelId);
        if (nextModels.length === models.length) {
            return res.status(404).json({ error: '找不到模型' });
        }

        provider.models = nextModels;
        clearActiveModelIfMissing(config);
        await writeOpenclawConfig(config);

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/active-model', requireAuth, async (req, res) => {
    const modelStr = typeof req.body.modelStr === 'string' ? req.body.modelStr.trim() : '';
    if (!modelStr || !modelStr.includes('/')) {
        return res.status(400).json({ error: '默认模型格式不合法' });
    }

    const [providerName, ...modelParts] = modelStr.split('/');
    const modelId = modelParts.join('/');

    try {
        const config = await readOpenclawConfig();
        const provider = config.models?.providers?.[providerName];
        const exists = Array.isArray(provider?.models) && provider.models.some((model) => model.id === modelId);
        if (!exists) {
            return res.status(404).json({ error: '目标模型不存在' });
        }

        ensureAgentDefaults(config);
        config.agents.defaults.model.primary = modelStr;
        await writeOpenclawConfig(config);

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.get('/api/service/status', requireAuth, async (req, res) => {
    const result = await runServiceCommand('status');
    if (!result.success) {
        return res.status(500).json({
            error: result.error || '获取 Gateway 服务状态失败',
            output: result.output || '',
            active: result.active || 'unknown',
            subState: result.subState || 'unknown',
            enabled: result.enabled || 'unknown',
            unit: result.unit || '',
            scope: result.scope || ''
        });
    }

    const isRunning = result.active === 'active';
    return res.json({
        output: result.output || '',
        isRunning,
        active: result.active || 'unknown',
        subState: result.subState || 'unknown',
        enabled: result.enabled || 'unknown',
        unit: result.unit || '',
        scope: result.scope || '',
        serviceFile: result.serviceFile || ''
    });
});

app.post('/api/service/restart', requireAuth, async (req, res) => {
    const result = await runServiceCommand('restart');
    if (!result.success) {
        return res.status(500).json({
            error: result.error || '重启 Gateway 服务失败',
            output: result.output || '',
            active: result.active || 'unknown',
            subState: result.subState || 'unknown',
            enabled: result.enabled || 'unknown',
            unit: result.unit || '',
            scope: result.scope || ''
        });
    }
    return res.json({
        success: true,
        output: result.output || '',
        active: result.active || 'unknown',
        subState: result.subState || 'unknown',
        enabled: result.enabled || 'unknown',
        unit: result.unit || '',
        scope: result.scope || ''
    });
});

app.post('/api/service/stop', requireAuth, async (req, res) => {
    const result = await runServiceCommand('stop');
    if (!result.success) {
        return res.status(500).json({
            error: result.error || '停止 Gateway 服务失败',
            output: result.output || '',
            active: result.active || 'unknown',
            subState: result.subState || 'unknown',
            enabled: result.enabled || 'unknown',
            unit: result.unit || '',
            scope: result.scope || ''
        });
    }
    return res.json({
        success: true,
        output: result.output || '',
        active: result.active || 'unknown',
        subState: result.subState || 'unknown',
        enabled: result.enabled || 'unknown',
        unit: result.unit || '',
        scope: result.scope || ''
    });
});

app.get('/style.css', express.static(PUBLIC_DIR, { index: false }));
app.get('/app.js', express.static(PUBLIC_DIR, { index: false }));
app.get('/login.js', express.static(PUBLIC_DIR, { index: false }));
app.get('/settings.js', express.static(PUBLIC_DIR, { index: false }));

app.get('/login', (req, res) => {
    res.redirect('/login.html');
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.get('/', requirePageAuth, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/index.html', requirePageAuth, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/settings', requirePageAuth, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'settings.html'));
});

app.get('/settings.html', requirePageAuth, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'settings.html'));
});

app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
});

app.listen(PORT, HOST, () => {
    console.log(`OpenClaw Panel is running on http://${HOST}:${PORT}`);
});
