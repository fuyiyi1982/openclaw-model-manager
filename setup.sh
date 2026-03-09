#!/bin/bash

set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
    echo "请使用 sudo 运行此脚本: sudo ./setup.sh"
    exit 1
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
RUNTIME_DIR="/etc/openclaw-panel"
RUNTIME_ENV="${RUNTIME_DIR}/runtime.env"
CONFIG_PROXY="/usr/local/bin/manage-openclaw-config.sh"
SERVICE_PROXY="/usr/local/bin/manage-openclaw-service.sh"
SUDOERS_FILE="/etc/sudoers.d/openclaw-panel-manage"
PANEL_SERVICE_PATH="/etc/systemd/system/openclaw-model-manager.service"
GENERATED_GATEWAY_SERVICE_PATH="/etc/systemd/system/openclaw-gateway.service"

cd "${DIR}"

if [ -f "${DIR}/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "${DIR}/.env"
    set +a
fi

log() {
    echo "[setup] $*"
}

fail() {
    echo "[setup] 错误: $*" >&2
    exit 1
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

resolve_realpath() {
    local target="$1"
    if command_exists realpath; then
        realpath "${target}"
    else
        readlink -f "${target}"
    fi
}

resolve_bin() {
    local preferred="${1:-}"
    local fallback_name="${2}"
    local candidate=""

    if [ -n "${preferred}" ] && [ -x "${preferred}" ]; then
        candidate="${preferred}"
    elif command_exists "${fallback_name}"; then
        candidate="$(command -v "${fallback_name}")"
    fi

    [ -n "${candidate}" ] || return 1
    resolve_realpath "${candidate}"
}

extract_unit_value() {
    local key="$1"
    local file="$2"
    awk -F= -v lookup="${key}" '$1 == lookup { print substr($0, index($0, "=") + 1); exit }' "${file}"
}

extract_unit_environment() {
    local name="$1"
    local file="$2"
    awk -v lookup="${name}" '
        $1 == "Environment" {
            value = substr($0, index($0, "=") + 1)
            gsub(/"/, "", value)
            split(value, parts, /[[:space:]]+/)
            for (i in parts) {
                if (index(parts[i], lookup "=") == 1) {
                    print substr(parts[i], length(lookup) + 2)
                    exit
                }
            }
        }
    ' "${file}"
}

find_existing_gateway_service() {
    local path=""
    local dirs=(
        "/etc/systemd/system"
        "/lib/systemd/system"
        "/usr/lib/systemd/system"
        "/root/.config/systemd/user"
        "/home"/*"/.config/systemd/user"
    )
    local patterns=("openclaw-gateway.service" "openclaw-gateway-*.service")

    for dir in "${dirs[@]}"; do
        [ -d "${dir}" ] || continue
        for pattern in "${patterns[@]}"; do
            for path in "${dir}/${pattern}"; do
                [ -f "${path}" ] || continue
                printf '%s\n' "${path}"
                return 0
            done
        done
    done

    return 1
}

resolve_target_user() {
    local candidate="${TARGET_USER:-}"
    if [ -n "${candidate}" ] && id -u "${candidate}" >/dev/null 2>&1; then
        printf '%s\n' "${candidate}"
        return 0
    fi

    if [ -n "${EXISTING_GATEWAY_SERVICE_PATH:-}" ]; then
        if [[ "${EXISTING_GATEWAY_SERVICE_PATH}" == /home/*/.config/systemd/user/* ]]; then
            printf '%s\n' "$(printf '%s\n' "${EXISTING_GATEWAY_SERVICE_PATH}" | cut -d/ -f3)"
            return 0
        fi
        if [[ "${EXISTING_GATEWAY_SERVICE_PATH}" == /root/.config/systemd/user/* ]]; then
            printf 'root\n'
            return 0
        fi

        candidate="$(extract_unit_value "User" "${EXISTING_GATEWAY_SERVICE_PATH}" || true)"
        if [ -n "${candidate}" ] && id -u "${candidate}" >/dev/null 2>&1; then
            printf '%s\n' "${candidate}"
            return 0
        fi
    fi

    if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ] && id -u "${SUDO_USER}" >/dev/null 2>&1; then
        printf '%s\n' "${SUDO_USER}"
        return 0
    fi

    printf 'root\n'
}

resolve_target_home() {
    getent passwd "$1" | cut -d: -f6
}

resolve_panel_user() {
    local candidate="${PANEL_USER:-}"
    if [ -n "${candidate}" ] && id -u "${candidate}" >/dev/null 2>&1; then
        printf '%s\n' "${candidate}"
        return 0
    fi

    stat -c '%U' "${DIR}/server.js"
}

discover_config_candidates() {
    local target_user="$1"
    local target_home="$2"
    local service_file="${3:-}"
    local service_config=""
    local service_state_dir=""
    local service_profile=""

    if [ -n "${OPENCLAW_CONFIG_PATH:-}" ]; then
        printf '%s\n' "${OPENCLAW_CONFIG_PATH}"
    fi

    if [ -n "${service_file}" ] && [ -f "${service_file}" ]; then
        service_config="$(extract_unit_environment "OPENCLAW_CONFIG_PATH" "${service_file}" || true)"
        service_state_dir="$(extract_unit_environment "OPENCLAW_STATE_DIR" "${service_file}" || true)"
        service_profile="$(extract_unit_environment "OPENCLAW_PROFILE" "${service_file}" || true)"

        [ -n "${service_config}" ] && printf '%s\n' "${service_config}"
        [ -n "${service_state_dir}" ] && printf '%s/openclaw.json\n' "${service_state_dir}"
        if [ -n "${service_profile}" ]; then
            printf '%s/.openclaw-%s/openclaw.json\n' "${target_home}" "${service_profile}"
        fi
    fi

    printf '%s/.openclaw/openclaw.json\n' "${target_home}"
    find "${target_home}" -maxdepth 2 -type f -path '*/.openclaw*/openclaw.json' 2>/dev/null || true
    find /root /home -maxdepth 3 -type f -path '*/.openclaw*/openclaw.json' 2>/dev/null || true
}

select_config_path() {
    local target_user="$1"
    local selected=""
    local line=""
    local -a owned_matches=()
    local -a all_matches=()

    while IFS= read -r line; do
        [ -n "${line}" ] || continue
        if [ -f "${line}" ]; then
            all_matches+=("${line}")
            if [ "$(stat -c '%U' "${line}")" = "${target_user}" ]; then
                owned_matches+=("${line}")
            fi
        fi
    done

    if [ "${#owned_matches[@]}" -gt 0 ]; then
        printf '%s\n' "${owned_matches[0]}"
        return 0
    fi

    if [ "${#all_matches[@]}" -gt 0 ]; then
        printf '%s\n' "${all_matches[0]}"
        return 0
    fi

    return 1
}

detect_service_scope() {
    local service_path="$1"
    if [[ "${service_path}" == /etc/systemd/system/* || "${service_path}" == /lib/systemd/system/* || "${service_path}" == /usr/lib/systemd/system/* ]]; then
        printf 'system\n'
    else
        printf 'user\n'
    fi
}

shell_quote() {
    printf "%q" "$1"
}

write_runtime_env() {
    mkdir -p "${RUNTIME_DIR}"
    cat >"${RUNTIME_ENV}" <<EOF
TARGET_USER=$(shell_quote "${TARGET_USER_RESOLVED}")
TARGET_UID=$(shell_quote "${TARGET_UID_RESOLVED}")
TARGET_HOME=$(shell_quote "${TARGET_HOME_RESOLVED}")
PANEL_USER=$(shell_quote "${PANEL_USER_RESOLVED}")
PANEL_UID=$(shell_quote "${PANEL_UID_RESOLVED}")
OPENCLAW_BIN=$(shell_quote "${OPENCLAW_BIN_RESOLVED}")
NODE_BIN=$(shell_quote "${NODE_BIN_RESOLVED}")
OPENCLAW_CONFIG_PATH=$(shell_quote "${OPENCLAW_CONFIG_PATH_RESOLVED}")
OPENCLAW_STATE_DIR=$(shell_quote "${OPENCLAW_STATE_DIR_RESOLVED}")
SERVICE_SCOPE=$(shell_quote "${SERVICE_SCOPE_RESOLVED}")
SERVICE_UNIT=$(shell_quote "${SERVICE_UNIT_RESOLVED}")
SERVICE_FILE=$(shell_quote "${SERVICE_FILE_RESOLVED}")
SERVICE_CREATED=$(shell_quote "${SERVICE_CREATED_RESOLVED}")
PANEL_DIR=$(shell_quote "${DIR}")
PANEL_PORT=$(shell_quote "${PORT:-1109}")
PANEL_HOST=$(shell_quote "${HOST:-0.0.0.0}")
EOF
    chmod 600 "${RUNTIME_ENV}"
}

write_config_proxy() {
    cat >"${CONFIG_PROXY}" <<'EOF'
#!/bin/bash
set -euo pipefail

RUNTIME_ENV="/etc/openclaw-panel/runtime.env"
[ -f "${RUNTIME_ENV}" ] || {
    echo "运行时配置不存在，请重新执行 setup.sh" >&2
    exit 1
}

set -a
# shellcheck disable=SC1091
. "${RUNTIME_ENV}"
set +a

mkdir -p "$(dirname "${OPENCLAW_CONFIG_PATH}")"

case "${1:-}" in
    read)
        [ -f "${OPENCLAW_CONFIG_PATH}" ] || {
            echo "OpenClaw 配置文件不存在: ${OPENCLAW_CONFIG_PATH}" >&2
            exit 1
        }
        cat "${OPENCLAW_CONFIG_PATH}"
        ;;
    write)
        tmp_file="$(mktemp)"
        trap 'rm -f "${tmp_file}"' EXIT
        cat >"${tmp_file}"
        install -m 600 -o "${TARGET_USER}" -g "$(id -gn "${TARGET_USER}")" "${tmp_file}" "${OPENCLAW_CONFIG_PATH}"
        ;;
    *)
        echo "用法: ${0} <read|write>" >&2
        exit 1
        ;;
esac
EOF
    chmod 755 "${CONFIG_PROXY}"
}

write_service_proxy() {
    cat >"${SERVICE_PROXY}" <<'EOF'
#!/bin/bash
set -euo pipefail

RUNTIME_ENV="/etc/openclaw-panel/runtime.env"
[ -f "${RUNTIME_ENV}" ] || {
    echo "运行时配置不存在，请重新执行 setup.sh" >&2
    exit 1
}

set -a
# shellcheck disable=SC1091
. "${RUNTIME_ENV}"
set +a

ACTION="${1:-status}"

run_systemctl() {
    local -a cmd=()
    if [ "${SERVICE_SCOPE}" = "user" ]; then
        cmd=(
            runuser
            -u "${TARGET_USER}"
            --
            env
            "HOME=${TARGET_HOME}"
            "XDG_RUNTIME_DIR=/run/user/${TARGET_UID}"
            "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${TARGET_UID}/bus"
            systemctl
            --user
        )
    else
        cmd=(systemctl)
    fi

    "${cmd[@]}" "$@"
}

emit_json() {
    local success="$1"
    local active="$2"
    local sub_state="$3"
    local enabled="$4"
    local error_message="${5:-}"
    local output="${6:-}"

    ACTION="${ACTION}" \
    SUCCESS="${success}" \
    ACTIVE_STATE="${active}" \
    SUB_STATE="${sub_state}" \
    ENABLED_STATE="${enabled}" \
    ERROR_MESSAGE="${error_message}" \
    "${NODE_BIN}" -e '
        const fs = require("fs");
        const payload = {
            action: process.env.ACTION,
            success: process.env.SUCCESS === "true",
            scope: process.env.SERVICE_SCOPE,
            unit: process.env.SERVICE_UNIT,
            serviceFile: process.env.SERVICE_FILE,
            targetUser: process.env.TARGET_USER,
            active: process.env.ACTIVE_STATE || "unknown",
            subState: process.env.SUB_STATE || "unknown",
            enabled: process.env.ENABLED_STATE || "unknown",
            error: process.env.ERROR_MESSAGE || "",
            output: fs.readFileSync(0, "utf8").trim()
        };
        process.stdout.write(JSON.stringify(payload));
    ' <<<"${output}"
}

ensure_service_defined() {
    if [ -z "${SERVICE_UNIT}" ]; then
        emit_json "false" "unknown" "unknown" "unknown" "未发现可接管的 OpenClaw systemd 服务" ""
        exit 1
    fi
}

status_command() {
    local active="unknown"
    local sub_state="unknown"
    local enabled="unknown"
    local output=""

    ensure_service_defined

    active="$(run_systemctl is-active "${SERVICE_UNIT}" 2>/dev/null || true)"
    enabled="$(run_systemctl is-enabled "${SERVICE_UNIT}" 2>/dev/null || true)"
    sub_state="$(run_systemctl show -p SubState --value "${SERVICE_UNIT}" 2>/dev/null || true)"
    output="$(run_systemctl status "${SERVICE_UNIT}" --no-pager --full -l 2>&1 || true)"

    emit_json "true" "${active}" "${sub_state}" "${enabled}" "" "${output}"
}

service_command() {
    local operation="$1"
    local active="unknown"
    local sub_state="unknown"
    local enabled="unknown"
    local output=""
    local error_message=""

    ensure_service_defined

    if output="$(run_systemctl "${operation}" "${SERVICE_UNIT}" 2>&1)"; then
        active="$(run_systemctl is-active "${SERVICE_UNIT}" 2>/dev/null || true)"
        enabled="$(run_systemctl is-enabled "${SERVICE_UNIT}" 2>/dev/null || true)"
        sub_state="$(run_systemctl show -p SubState --value "${SERVICE_UNIT}" 2>/dev/null || true)"
        emit_json "true" "${active}" "${sub_state}" "${enabled}" "" "${output}"
        return 0
    fi

    error_message="systemctl ${operation} 执行失败"
    active="$(run_systemctl is-active "${SERVICE_UNIT}" 2>/dev/null || true)"
    enabled="$(run_systemctl is-enabled "${SERVICE_UNIT}" 2>/dev/null || true)"
    sub_state="$(run_systemctl show -p SubState --value "${SERVICE_UNIT}" 2>/dev/null || true)"
    emit_json "false" "${active}" "${sub_state}" "${enabled}" "${error_message}" "${output}"
    return 1
}

case "${ACTION}" in
    status)
        status_command
        ;;
    start|stop|restart|reload)
        service_command "${ACTION}"
        ;;
    *)
        emit_json "false" "unknown" "unknown" "unknown" "不支持的操作: ${ACTION}" ""
        exit 1
        ;;
esac
EOF
    chmod 755 "${SERVICE_PROXY}"
}

write_sudoers() {
    cat >"${SUDOERS_FILE}" <<EOF
${PANEL_USER_RESOLVED} ALL=(root) NOPASSWD: ${CONFIG_PROXY}
${PANEL_USER_RESOLVED} ALL=(root) NOPASSWD: ${SERVICE_PROXY}
EOF
    chmod 440 "${SUDOERS_FILE}"
}

write_gateway_service() {
    cat >"${GENERATED_GATEWAY_SERVICE_PATH}" <<EOF
[Unit]
Description=OpenClaw Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${TARGET_USER_RESOLVED}
WorkingDirectory=${TARGET_HOME_RESOLVED}
Environment=HOME=${TARGET_HOME_RESOLVED}
Environment=PATH=$(dirname "${OPENCLAW_BIN_RESOLVED}"):$(dirname "${NODE_BIN_RESOLVED}"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=OPENCLAW_CONFIG_PATH=${OPENCLAW_CONFIG_PATH_RESOLVED}
Environment=OPENCLAW_STATE_DIR=${OPENCLAW_STATE_DIR_RESOLVED}
ExecStart=${OPENCLAW_BIN_RESOLVED} gateway
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}

write_panel_service() {
    cat >"${PANEL_SERVICE_PATH}" <<EOF
[Unit]
Description=OpenClaw Model Manager
After=network.target
Wants=network.target

[Service]
Type=simple
User=${PANEL_USER_RESOLVED}
WorkingDirectory=${DIR}
Environment=NODE_ENV=production
Environment=HOST=${HOST:-0.0.0.0}
Environment=PORT=${PORT:-1109}
ExecStart=${NODE_BIN_RESOLVED} ${DIR}/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
}

maybe_install_dependencies() {
    local npm_bin=""
    if [ -d "${DIR}/node_modules" ]; then
        return 0
    fi

    npm_bin="$(resolve_bin "${NPM_BIN:-}" "npm" || true)"
    if [ -z "${npm_bin}" ]; then
        log "未找到 npm，跳过依赖安装"
        return 0
    fi

    log "检测到缺少 node_modules，执行依赖安装"
    "${npm_bin}" install --omit=dev
}

maybe_start_panel_service() {
    if [ ! -d "${DIR}/node_modules" ]; then
        log "依赖未安装完成，跳过自动启动 openclaw-model-manager.service"
        return 0
    fi

    systemctl enable openclaw-model-manager.service >/dev/null 2>&1 || true
    systemctl restart openclaw-model-manager.service >/dev/null 2>&1 || true
}

[ -d "${DIR}" ] || fail "项目目录不存在: ${DIR}"
OPENCLAW_BIN_RESOLVED="$(resolve_bin "${OPENCLAW_BIN:-}" "openclaw")" || fail "无法找到 openclaw 可执行文件"
NODE_BIN_RESOLVED="$(resolve_bin "${NODE_BIN:-}" "node")" || fail "无法找到 node 可执行文件"

EXISTING_GATEWAY_SERVICE_PATH="$(find_existing_gateway_service || true)"
TARGET_USER_RESOLVED="$(resolve_target_user)"
TARGET_UID_RESOLVED="$(id -u "${TARGET_USER_RESOLVED}")"
TARGET_HOME_RESOLVED="$(resolve_target_home "${TARGET_USER_RESOLVED}")"
PANEL_USER_RESOLVED="$(resolve_panel_user)"
PANEL_UID_RESOLVED="$(id -u "${PANEL_USER_RESOLVED}")"

OPENCLAW_CONFIG_PATH_RESOLVED="$(
    discover_config_candidates "${TARGET_USER_RESOLVED}" "${TARGET_HOME_RESOLVED}" "${EXISTING_GATEWAY_SERVICE_PATH:-}" | sort -u | \
        select_config_path "${TARGET_USER_RESOLVED}" || true
)"
if [ -z "${OPENCLAW_CONFIG_PATH_RESOLVED}" ]; then
    OPENCLAW_CONFIG_PATH_RESOLVED="${TARGET_HOME_RESOLVED}/.openclaw/openclaw.json"
fi
OPENCLAW_STATE_DIR_RESOLVED="$(dirname "${OPENCLAW_CONFIG_PATH_RESOLVED}")"
mkdir -p "${OPENCLAW_STATE_DIR_RESOLVED}"
chown "${TARGET_USER_RESOLVED}:$(id -gn "${TARGET_USER_RESOLVED}")" "${OPENCLAW_STATE_DIR_RESOLVED}"

SERVICE_CREATED_RESOLVED="false"
if [ -n "${EXISTING_GATEWAY_SERVICE_PATH}" ]; then
    SERVICE_SCOPE_RESOLVED="$(detect_service_scope "${EXISTING_GATEWAY_SERVICE_PATH}")"
    SERVICE_FILE_RESOLVED="${EXISTING_GATEWAY_SERVICE_PATH}"
    SERVICE_UNIT_RESOLVED="$(basename "${EXISTING_GATEWAY_SERVICE_PATH}")"
else
    log "未发现现成的 OpenClaw Gateway unit，生成标准 system service: ${GENERATED_GATEWAY_SERVICE_PATH}"
    write_gateway_service
    systemctl daemon-reload
    systemctl enable --now openclaw-gateway.service >/dev/null 2>&1 || true
    SERVICE_SCOPE_RESOLVED="system"
    SERVICE_FILE_RESOLVED="${GENERATED_GATEWAY_SERVICE_PATH}"
    SERVICE_UNIT_RESOLVED="openclaw-gateway.service"
    SERVICE_CREATED_RESOLVED="true"
fi

write_runtime_env
write_config_proxy
write_service_proxy
write_sudoers
write_panel_service
maybe_install_dependencies
systemctl daemon-reload
maybe_start_panel_service

log "================================"
log "OpenClaw Model Manager 自动部署完成"
log "面板用户: ${PANEL_USER_RESOLVED} (UID: ${PANEL_UID_RESOLVED})"
log "Gateway 用户: ${TARGET_USER_RESOLVED} (UID: ${TARGET_UID_RESOLVED})"
log "openclaw 路径: ${OPENCLAW_BIN_RESOLVED}"
log "node 路径: ${NODE_BIN_RESOLVED}"
log "OpenClaw 配置: ${OPENCLAW_CONFIG_PATH_RESOLVED}"
log "Gateway unit: ${SERVICE_UNIT_RESOLVED} (${SERVICE_SCOPE_RESOLVED})"
log "Gateway unit 文件: ${SERVICE_FILE_RESOLVED}"
log "面板服务文件: ${PANEL_SERVICE_PATH}"
log "运行时配置: ${RUNTIME_ENV}"
log "================================"
log "如需手动检查:"
log "  1. systemctl status ${SERVICE_UNIT_RESOLVED}"
log "  2. systemctl status openclaw-model-manager.service"
