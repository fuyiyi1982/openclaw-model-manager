#!/bin/bash
# 自动化环境部署脚本
if [ "$EUID" -ne 0 ]; then
  echo "请使用 sudo 运行此脚本: sudo ./setup.sh"
  exit 1
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
cd "$DIR"

# 读取 .env 文件
if [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "未找到 .env 文件，使用默认值..."
    TARGET_USER="root"
    TARGET_UID="0"
    OPENCLAW_CONFIG_PATH="/root/.openclaw/openclaw.json"
    OPENCLAW_BIN="/usr/bin/openclaw"
fi

CURRENT_USER=$(stat -c '%U' "$DIR/server.js")

echo "================================"
echo "OpenClaw Panel 环境配置安装"
echo "面板运行用户: $CURRENT_USER"
echo "目标管理用户: $TARGET_USER (UID: $TARGET_UID)"
echo "配置文件路径: $OPENCLAW_CONFIG_PATH"
echo "可执行文件: $OPENCLAW_BIN"
echo "================================"

# 1. 创建配置读写代理脚本
cat > /usr/local/bin/manage-openclaw-config.sh << EOT
#!/bin/bash
if [ "\$1" = "read" ]; then
  cat $OPENCLAW_CONFIG_PATH
elif [ "\$1" = "write" ]; then
  cat > $OPENCLAW_CONFIG_PATH
fi
EOT
chmod +x /usr/local/bin/manage-openclaw-config.sh

# 2. 创建服务控制代理脚本
cat > /usr/local/bin/manage-openclaw-service.sh << EOT
#!/bin/bash
export XDG_RUNTIME_DIR=/run/user/$TARGET_UID
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$TARGET_UID/bus
if [ "\$1" = "status" ]; then
  $OPENCLAW_BIN gateway status 2>&1
elif [ "\$1" = "restart" ]; then
  $OPENCLAW_BIN gateway restart 2>&1
elif [ "\$1" = "stop" ]; then
  $OPENCLAW_BIN gateway stop 2>&1
fi
EOT
chmod +x /usr/local/bin/manage-openclaw-service.sh

# 3. 授予 sudo 权限
echo "$CURRENT_USER ALL=(ALL) NOPASSWD: /usr/local/bin/manage-openclaw-config.sh" > /etc/sudoers.d/openclaw-panel-manage
echo "$CURRENT_USER ALL=(ALL) NOPASSWD: /usr/local/bin/manage-openclaw-service.sh" >> /etc/sudoers.d/openclaw-panel-manage
chmod 440 /etc/sudoers.d/openclaw-panel-manage

echo "部署完成！现在可以启动面板了。"
