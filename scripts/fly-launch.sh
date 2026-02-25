#!/bin/bash
# Fly.io launch and configuration script for Eigennamen Online
#
# Usage:
#   ./scripts/fly-launch.sh              # Interactive first-time setup
#   ./scripts/fly-launch.sh --deploy     # Deploy (skip app creation)
#   ./scripts/fly-launch.sh --secrets    # Set/rotate secrets only
#   ./scripts/fly-launch.sh --status     # Check app status
#
# Prerequisites: fly CLI installed and authenticated (fly auth login)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Defaults matching fly.toml
DEFAULT_APP_NAME="eigennamen"
DEFAULT_REGION="iad"
DEFAULT_VM_MEMORY="512"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; }

# ── Preflight checks ──────────────────────────────────────────────

check_prerequisites() {
    info "Checking prerequisites..."

    if ! command -v fly &>/dev/null; then
        error "flyctl is not installed. Install it from https://fly.io/docs/flyctl/install/"
        exit 1
    fi
    success "flyctl found: $(fly version 2>/dev/null | head -1)"

    if ! fly auth whoami &>/dev/null; then
        error "Not authenticated. Run: fly auth login"
        exit 1
    fi
    success "Authenticated as: $(fly auth whoami 2>/dev/null)"

    if [ ! -f "$PROJECT_ROOT/fly.toml" ]; then
        error "fly.toml not found in project root: $PROJECT_ROOT"
        exit 1
    fi
    success "fly.toml found"
}

# ── App creation ──────────────────────────────────────────────────

get_app_name() {
    # Read app name from fly.toml
    local name
    name=$(grep '^app = ' "$PROJECT_ROOT/fly.toml" | sed 's/app = "\(.*\)"/\1/')
    echo "${name:-$DEFAULT_APP_NAME}"
}

app_exists() {
    fly apps list 2>/dev/null | grep -q "$(get_app_name)"
}

create_app() {
    local app_name
    app_name=$(get_app_name)

    if app_exists; then
        info "App '$app_name' already exists, skipping creation"
        return 0
    fi

    info "Creating Fly.io app: $app_name"
    echo ""
    read -rp "App name [$app_name]: " input_name
    app_name="${input_name:-$app_name}"

    read -rp "Primary region [$DEFAULT_REGION]: " input_region
    local region="${input_region:-$DEFAULT_REGION}"

    fly apps create "$app_name" --org personal 2>/dev/null || true
    success "App '$app_name' created in region '$region'"

    # Update fly.toml if app name changed
    if [ "$app_name" != "$(get_app_name)" ]; then
        sed -i "s/^app = .*/app = \"$app_name\"/" "$PROJECT_ROOT/fly.toml"
        info "Updated fly.toml with app name: $app_name"
    fi
}

# ── Secrets management ────────────────────────────────────────────

set_secrets() {
    local app_name
    app_name=$(get_app_name)
    info "Configuring secrets for '$app_name'..."
    echo ""

    local secrets_to_set=()
    local existing_secrets
    existing_secrets=$(fly secrets list -a "$app_name" 2>/dev/null || echo "")

    # ADMIN_PASSWORD
    if echo "$existing_secrets" | grep -q "ADMIN_PASSWORD"; then
        info "ADMIN_PASSWORD is already set"
        read -rp "  Rotate it? [y/N]: " rotate_admin
        if [[ "$rotate_admin" =~ ^[Yy]$ ]]; then
            local admin_pw
            admin_pw=$(openssl rand -base64 24)
            secrets_to_set+=("ADMIN_PASSWORD=$admin_pw")
            success "ADMIN_PASSWORD will be rotated"
            warn "New admin password: $admin_pw"
            warn "Save this - it won't be shown again!"
        fi
    else
        warn "ADMIN_PASSWORD not set - admin dashboard will be inaccessible"
        read -rp "  Set ADMIN_PASSWORD? [Y/n]: " set_admin
        if [[ ! "$set_admin" =~ ^[Nn]$ ]]; then
            read -rsp "  Enter password (or press Enter to auto-generate): " admin_input
            echo ""
            if [ -z "$admin_input" ]; then
                admin_input=$(openssl rand -base64 24)
                warn "Generated admin password: $admin_input"
                warn "Save this - it won't be shown again!"
            fi
            secrets_to_set+=("ADMIN_PASSWORD=$admin_input")
        fi
    fi

    # JWT_SECRET
    if echo "$existing_secrets" | grep -q "JWT_SECRET"; then
        info "JWT_SECRET is already set"
    else
        warn "JWT_SECRET not set - user auth is disabled (anonymous play only)"
        read -rp "  Set JWT_SECRET? [Y/n]: " set_jwt
        if [[ ! "$set_jwt" =~ ^[Nn]$ ]]; then
            local jwt_secret
            jwt_secret=$(openssl rand -hex 32)
            secrets_to_set+=("JWT_SECRET=$jwt_secret")
            success "JWT_SECRET will be set (auto-generated)"
        fi
    fi

    # REDIS_URL
    if echo "$existing_secrets" | grep -q "REDIS_URL"; then
        info "REDIS_URL is already set as a secret"
    else
        echo ""
        info "REDIS_URL is currently set to 'memory' in fly.toml (in-memory mode)"
        warn "In-memory mode: data lost on restart, limited to 1 machine"
        echo "  To provision Redis: fly redis create"
        read -rp "  Enter Redis URL (or press Enter to keep memory mode): " redis_input
        if [ -n "$redis_input" ]; then
            secrets_to_set+=("REDIS_URL=$redis_input")
            success "REDIS_URL will be set"
            info "Remember to remove REDIS_URL and MEMORY_MODE_ALLOW_FLY from fly.toml [env]"
        else
            info "Keeping in-memory mode"
        fi
    fi

    # Apply secrets
    if [ ${#secrets_to_set[@]} -gt 0 ]; then
        echo ""
        info "Setting ${#secrets_to_set[@]} secret(s)..."
        fly secrets set "${secrets_to_set[@]}" -a "$app_name"
        success "Secrets configured"
    else
        info "No secrets to update"
    fi
}

# ── Deployment ────────────────────────────────────────────────────

deploy() {
    local app_name
    app_name=$(get_app_name)
    info "Deploying '$app_name'..."

    cd "$PROJECT_ROOT"

    # Run pre-deploy checks if available
    if [ -x "$SCRIPT_DIR/pre-deploy-check.sh" ]; then
        info "Running pre-deploy checks..."
        if ! "$SCRIPT_DIR/pre-deploy-check.sh"; then
            error "Pre-deploy checks failed. Fix errors before deploying."
            read -rp "Deploy anyway? [y/N]: " force_deploy
            if [[ ! "$force_deploy" =~ ^[Yy]$ ]]; then
                exit 1
            fi
            warn "Deploying despite failed checks..."
        fi
    fi

    fly deploy -a "$app_name"
    success "Deployment complete!"

    # Scale to 1 machine if using memory mode
    local env_redis
    env_redis=$(grep 'REDIS_URL' "$PROJECT_ROOT/fly.toml" 2>/dev/null | grep -v '^#' | head -1 || echo "")
    if echo "$env_redis" | grep -q 'memory'; then
        info "Memory mode detected - ensuring exactly 1 machine"
        fly scale count 1 -a "$app_name" --yes 2>/dev/null || true
    fi

    echo ""
    show_status
}

# ── Status ────────────────────────────────────────────────────────

show_status() {
    local app_name
    app_name=$(get_app_name)
    info "Status for '$app_name'"
    echo ""

    echo "--- Machines ---"
    fly machines list -a "$app_name" 2>/dev/null || warn "Could not list machines"
    echo ""

    echo "--- Secrets (names only) ---"
    fly secrets list -a "$app_name" 2>/dev/null || warn "Could not list secrets"
    echo ""

    # Check required secrets
    local secrets_output
    secrets_output=$(fly secrets list -a "$app_name" 2>/dev/null || echo "")
    local missing=0

    if ! echo "$secrets_output" | grep -q "ADMIN_PASSWORD"; then
        warn "ADMIN_PASSWORD not set - admin dashboard inaccessible"
        missing=1
    fi
    if ! echo "$secrets_output" | grep -q "JWT_SECRET"; then
        warn "JWT_SECRET not set - user auth disabled"
        missing=1
    fi

    if [ $missing -eq 0 ]; then
        success "All recommended secrets are configured"
    fi

    echo ""
    local app_url="https://${app_name}.fly.dev"
    info "App URL: $app_url"
    info "Health:  $app_url/health/ready"
    info "Admin:   $app_url/admin"
    info "Logs:    fly logs -a $app_name"
}

# ── Main ──────────────────────────────────────────────────────────

main() {
    echo ""
    echo "========================================="
    echo "  Eigennamen Online - Fly.io Launcher"
    echo "========================================="
    echo ""

    check_prerequisites

    case "${1:-}" in
        --deploy)
            deploy
            ;;
        --secrets)
            set_secrets
            ;;
        --status)
            show_status
            ;;
        *)
            # Full interactive setup
            echo ""
            echo "--- Step 1: App Creation ---"
            create_app
            echo ""
            echo "--- Step 2: Secrets ---"
            set_secrets
            echo ""
            echo "--- Step 3: Deploy ---"
            read -rp "Deploy now? [Y/n]: " do_deploy
            if [[ ! "$do_deploy" =~ ^[Nn]$ ]]; then
                deploy
            else
                info "Skipping deploy. Run later with: fly deploy"
            fi
            ;;
    esac

    echo ""
    success "Done!"
}

main "$@"
