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

2. **可选：环境变量覆盖**
   默认情况下，`setup.sh` 会自动探测以下信息并生成运行时配置：
   - OpenClaw 的实际安装路径
   - Node 的实际安装路径
   - OpenClaw 的 `openclaw.json` 路径
   - 已存在的 `openclaw-gateway*.service`

   如果目标机器环境特别特殊，才需要编辑 `.env` 覆盖默认探测结果。常用覆盖项：
   - `TARGET_USER`: 运行 OpenClaw Gateway 的用户
   - `OPENCLAW_CONFIG_PATH`: 指定 `openclaw.json` 路径
   - `OPENCLAW_BIN`: 指定 `openclaw` 路径
   - `NODE_BIN`: 指定 `node` 路径
   - `PANEL_USER`: 指定面板服务运行用户

3. **执行一键初始化脚本（必须使用 sudo）**
   这一步会自动完成以下动作：
   - 探测并接管现有 OpenClaw systemd 服务
   - 如果没有 Gateway 服务，则生成标准的 `openclaw-gateway.service`
   - 生成运行时探测结果与管理代理脚本
   - 如果缺少依赖且系统存在 `npm`，自动执行 `npm install --omit=dev`
   - 生成 `openclaw-model-manager.service`
   - 配置面板所需的免密 `sudo`
   - 尝试启动面板服务
   ```bash
   sudo ./setup.sh
   ```

4. **依赖安装失败时手动补装**
   如果目标机器没有 `npm`，或者自动安装失败，再手动执行：
   ```bash
   npm install
   ```

5. **需要时手动重启面板服务**
   `setup.sh` 已经生成 `/etc/systemd/system/openclaw-model-manager.service` 并会尽量自动启动；如果需要手动重启：
   ```bash
   sudo systemctl restart openclaw-model-manager
   ```

## 默认账号
- **默认端口**: 1109
- **访问地址**: `http://<服务器IP>:1109`
- **默认密码**: `admin123` (首次登录后请务必在设置页面修改)
