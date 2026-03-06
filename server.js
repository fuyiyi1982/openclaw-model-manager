const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = 1109;
const HOST = '0.0.0.0';

const PANEL_CONFIG_PATH = path.join(__dirname, 'panel-config.json');
const OPENCLAW_CONFIG_PATH = "/home/fool11/openclaw-panel/openclaw-sample.json";

// Initialize panel config if it doesn't exist
if (!fs.existsSync(PANEL_CONFIG_PATH)) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync("admin123", salt);
    fs.writeFileSync(PANEL_CONFIG_PATH, JSON.stringify({ passwordHash: hash }, null, 2));
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'openclaw-panel-secret-key-12345',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Authentication Middleware
const requireAuth = (req, res, next) => {
    if (req.session.authenticated) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

// --- AUTH API ---
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    try {
        const config = JSON.parse(fs.readFileSync(PANEL_CONFIG_PATH, 'utf8'));
        if (bcrypt.compareSync(password, config.passwordHash)) {
            req.session.authenticated = true;
            res.json({ success: true });
        } else {
            res.status(401).json({ error: '密码错误' });
        }
    } catch (error) {
        res.status(500).json({ error: '读取配置失败' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.post('/api/change-password', requireAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    try {
        const config = JSON.parse(fs.readFileSync(PANEL_CONFIG_PATH, 'utf8'));
        if (bcrypt.compareSync(currentPassword, config.passwordHash)) {
            const salt = bcrypt.genSaltSync(10);
            config.passwordHash = bcrypt.hashSync(newPassword, salt);
            fs.writeFileSync(PANEL_CONFIG_PATH, JSON.stringify(config, null, 2));
            res.json({ success: true });
        } else {
            res.status(400).json({ error: '当前密码错误' });
        }
    } catch (error) {
        res.status(500).json({ error: '修改失败' });
    }
});

// --- OPENCLAW CONFIG API ---
const readOpenclawConfig = () => {
    const output = require('child_process').execSync('sudo /usr/local/bin/manage-openclaw-config.sh read', { encoding: 'utf8' });
    if (!output || output.trim() === '') {
        throw new Error('无法读取 OpenClaw 配置文件内容');
    }
    return JSON.parse(output);
};

const writeOpenclawConfig = (config) => {
    const configStr = JSON.stringify(config, null, 2);
    require('child_process').execSync('sudo /usr/local/bin/manage-openclaw-config.sh write', {
        input: configStr,
        encoding: 'utf8'
    });
};

app.get('/api/config', requireAuth, (req, res) => {
    try {
        const config = readOpenclawConfig();
        const providers = config.models?.providers || {};
        const activeModel = config.agents?.defaults?.model?.primary || '';

        res.json({
            providers,
            activeModel
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/providers', requireAuth, (req, res) => {
    const { name, baseUrl, apiKey, api } = req.body;
    try {
        const config = readOpenclawConfig();
        if (!config.models) config.models = {};
        if (!config.models.providers) config.models.providers = {};

        config.models.providers[name] = {
            baseUrl,
            apiKey,
            api,
            models: []
        };

        writeOpenclawConfig(config);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/providers/:name', requireAuth, (req, res) => {
    const { name } = req.params;
    try {
        const config = readOpenclawConfig();
        if (config.models?.providers && config.models.providers[name]) {
            delete config.models.providers[name];
            writeOpenclawConfig(config);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/providers/:providerName/models', requireAuth, (req, res) => {
    const { providerName } = req.params;
    const modelData = req.body;
    try {
        const config = readOpenclawConfig();
        if (config.models?.providers && config.models.providers[providerName]) {
            if (!config.models.providers[providerName].models) {
                config.models.providers[providerName].models = [];
            }

            const newModel = {
                id: modelData.id,
                name: modelData.name || modelData.id,
                reasoning: modelData.reasoning || false,
                input: modelData.input || ["text"],
                cost: modelData.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: modelData.contextWindow || 128000,
                maxTokens: modelData.maxTokens || 4096
            };

            config.models.providers[providerName].models.push(newModel);
            writeOpenclawConfig(config);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: '找不到提供商' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/providers/:providerName/models/:modelId', requireAuth, (req, res) => {
    const { providerName, modelId } = req.params;
    try {
        const config = readOpenclawConfig();
        if (config.models?.providers && config.models.providers[providerName]) {
            const models = config.models.providers[providerName].models || [];
            config.models.providers[providerName].models = models.filter(m => m.id !== modelId);
            writeOpenclawConfig(config);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.put('/api/providers/:oldName', requireAuth, (req, res) => {
    const { oldName } = req.params;
    const { name, baseUrl, apiKey, api } = req.body;
    try {
        const config = readOpenclawConfig();
        if (config.models?.providers && config.models.providers[oldName]) {
            const providerData = config.models.providers[oldName];
            
            // If name changed, move the object
            if (name && name !== oldName) {
                config.models.providers[name] = providerData;
                delete config.models.providers[oldName];
            }
            
            const targetName = name || oldName;
            if (baseUrl) config.models.providers[targetName].baseUrl = baseUrl;
            if (apiKey) config.models.providers[targetName].apiKey = apiKey;
            if (api) config.models.providers[targetName].api = api;

            // Also update active model if it matched this provider
            const activeModel = config.agents?.defaults?.model?.primary;
            if (activeModel && activeModel.startsWith(oldName + '/')) {
                config.agents.defaults.model.primary = activeModel.replace(oldName + '/', targetName + '/');
            }
            
            writeOpenclawConfig(config);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: '找不到提供商' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/providers/:providerName/models/:oldModelId', requireAuth, (req, res) => {
    const { providerName, oldModelId } = req.params;
    const { id, name, contextWindow, maxTokens } = req.body;
    try {
        const config = readOpenclawConfig();
        if (config.models?.providers && config.models.providers[providerName]) {
            const models = config.models.providers[providerName].models || [];
            const modelIndex = models.findIndex(m => m.id === oldModelId);
            
            if (modelIndex !== -1) {
                if (id) models[modelIndex].id = id;
                if (name) models[modelIndex].name = name;
                if (contextWindow) models[modelIndex].contextWindow = contextWindow;
                if (maxTokens) models[modelIndex].maxTokens = maxTokens;
                
                // Update active model reference if id changed
                if (id && id !== oldModelId) {
                    const activeModel = config.agents?.defaults?.model?.primary;
                    if (activeModel === providerName + '/' + oldModelId) {
                        config.agents.defaults.model.primary = providerName + '/' + id;
                    }
                }
                
                writeOpenclawConfig(config);
                res.json({ success: true });
            } else {
                res.status(404).json({ error: '找不到模型' });
            }
        } else {
            res.status(404).json({ error: '找不到提供商' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/active-model', requireAuth, (req, res) => {
    const { modelStr } = req.body;
    try {
        const config = readOpenclawConfig();
        if (!config.agents) config.agents = {};
        if (!config.agents.defaults) config.agents.defaults = {};
        if (!config.agents.defaults.model) config.agents.defaults.model = {};

        config.agents.defaults.model.primary = modelStr;
        writeOpenclawConfig(config);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- SERVICE API ---
app.get('/api/service/status', requireAuth, (req, res) => {
    exec('sudo /usr/local/bin/manage-openclaw-service.sh status', (error, stdout, stderr) => {
        const output = stdout || stderr || (error ? error.message : 'Unknown state');
        const isRunning = output.toLowerCase().includes('running (pid') || output.toLowerCase().includes('state active');
        res.json({
            output: output,
            isRunning: isRunning
        });
    });
});

app.post('/api/service/restart', requireAuth, (req, res) => {
    exec('sudo /usr/local/bin/manage-openclaw-service.sh restart', (error, stdout, stderr) => {
        if (error) {
            res.status(500).json({ error: error.message, output: stderr });
        } else {
            res.json({ success: true, output: stdout });
        }
    });
});

app.post('/api/service/stop', requireAuth, (req, res) => {
    exec('sudo /usr/local/bin/manage-openclaw-service.sh stop', (error, stdout, stderr) => {
        if (error) {
            res.status(500).json({ error: error.message, output: stderr });
        } else {
            res.json({ success: true, output: stdout });
        }
    });
});

// Main routes to serve HTML
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Protect static files
app.use((req, res, next) => {
    if (req.path === '/login.html' || req.path === '/style.css' || req.path === '/app.js') {
        return next();
    }
    if (req.session.authenticated) {
        next();
    } else {
        res.redirect('/login.html');
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/settings', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});

app.listen(PORT, HOST, () => {
    console.log(`OpenClaw Panel is running on http://${HOST}:${PORT}`);
});
