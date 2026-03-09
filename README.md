# OpenClaw Model Manager (OpenClaw 模型管理面板)

这是一个用于管理 OpenClaw 配置文件 (`openclaw.json`) 以及控制 Gateway 服务状态的独立 Web 面板。它提供了一个现代化的、无缝的 UI，用于在不同的提供商和模型之间进行切换配置。

## 特性

- 🔒 独立的密码登录防护
- 📦 渠道和模型的图形化管理
- ✨ 一键切换默认的 OpenClaw Agent 模型
- 🛠️ 实时查看并控制 OpenClaw Gateway Systemd 服务的状态

## 部署方法

1. **克隆项目到目标机器**
   ```bash
   git clone https://github.com/fuyiyi1982/openclaw-model-manager.git
   cd openclaw-model-manager
   ```

2. **配置环境变量**
   编辑项目根目录下的 `.env` 文件。根据机器上 OpenClaw 的实际安装情况进行修改：
   - `TARGET_USER`: 运行 OpenClaw 服务的用户名（如 `root` 或是普通用户名）。
   - `TARGET_UID`: 该用户的 UID，用来连接 systemd 服务（`root` 是 `0`，普通用户通常是 `1000`）。
   - `OPENCLAW_CONFIG_PATH`: `openclaw.json` 的绝对路径。
   - `OPENCLAW_BIN`: `openclaw` 命令的绝对路径。

3. **执行环境初始化脚本（必须使用 sudo）**
   这将在系统内生成必要的代理脚本，并配置免密 `sudo` 权限以跨越权限墙。
   ```bash
   sudo ./setup.sh
   ```

4. **安装依赖**
   ```bash
   npm install
   ```

5. **配置与启动系统服务**
   项目附带基于 Systemd 的管理方案，建议将其注册为系统服务以保证后台持续运行及开机自启。
   ```bash
   sudo cp openclaw-model-manager.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable openclaw-model-manager
   sudo systemctl start openclaw-model-manager
   ```

## 默认账号
- **默认端口**: 1109
- **访问地址**: `http://<服务器IP>:1109`
- **默认密码**: `admin123` (首次登录后请务必在设置页面修改)
