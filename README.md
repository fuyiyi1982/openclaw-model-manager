# OpenClaw 管理面板

这是一个用于管理 OpenClaw 配置文件 (`openclaw.json`) 以及控制 Gateway 服务状态的独立 Web 面板。

## 部署到新机器的方法

1. **打包与传输**
   将本目录 (`openclaw-panel`) 整体打包，并上传到新机器的目标目录。

2. **配置环境变量**
   打开目录下的 `.env` 文件。根据新机器上 OpenClaw 的实际安装情况进行修改：
   - `TARGET_USER`: 运行 OpenClaw 服务的用户名（如 `root` 或是你的普通用户名）。
   - `TARGET_UID`: 该用户的 UID，用来连接 systemd 服务（`root` 是 `0`，普通用户通常是 `1000`）。
   - `OPENCLAW_CONFIG_PATH`: `openclaw.json` 的绝对路径。
   - `OPENCLAW_BIN`: `openclaw` 命令的绝对路径。

3. **执行环境初始化脚本（必须使用 sudo）**
   这将在系统内生成必须的代理脚本，并为你当前的用户配置免密 `sudo` 权限以跨越权限墙。
   ```bash
   cd openclaw-panel
   sudo ./setup.sh
   ```

4. **安装依赖并启动**
   ```bash
   npm install
   node server.js
   ```

## 默认账号
- **端口**: 1109
- **密码**: admin123 (可在设置页面修改)
