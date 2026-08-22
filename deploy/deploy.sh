#!/usr/bin/env bash
# Deploy saliminn.my on the live payroll Lightsail VPS.
#
# Usage (as root):
#   deploy.sh <40-character-git-sha> <extracted-release-directory>
#
# The GitHub workflow builds linux/amd64 images and transfers them over SSH.
# This script verifies and loads those images, preserves host-generated secrets
# and application data, waits for every service to become healthy, and rolls the
# application images back when a release fails. It never contacts ECR, S3, SSM,
# Route53, or another billable deployment service.
set -Eeuo pipefail
umask 077

readonly APP_DIR=/opt/saliminn
readonly RELEASES_DIR="$APP_DIR/releases"
readonly COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
readonly SECRETS_FILE="$APP_DIR/secrets.env"
readonly CURRENT_TAG_FILE="$APP_DIR/current-tag"
readonly ADMIN_PASSWORD_FILE="$APP_DIR/initial-admin-password"
readonly ADMIN_PASSWORD_MARKER="$APP_DIR/admin-password-initialized"
readonly BACKUP_DIR="$APP_DIR/backups"
readonly LOCK_FILE="$APP_DIR/deploy.lock"
readonly CADDY_FILE=/etc/caddy/Caddyfile
readonly CADDY_SITE_FILE=/etc/caddy/saliminn.Caddyfile
readonly POSTGRES_IMAGE=postgres:19beta3
readonly COMPOSE_VERSION=v5.1.4
readonly COMPOSE_SHA256=33b208d7e76639db742fae84b966cc01dacae58ca3fc4dabbc907045aefdf0c4

TAG="${1:-}"
RELEASE_DIR="${2:-}"
COMPOSE_COMMAND=()

log() {
  printf '[saliminn-deploy] %s\n' "$*"
}

die() {
  printf '[saliminn-deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ $EUID -eq 0 ]] || die "run this script as root (sudo)"
[[ "$TAG" =~ ^[0-9a-f]{40}$ ]] || die "image tag must be a 40-character lowercase Git commit SHA"
[[ -n "$RELEASE_DIR" && -d "$RELEASE_DIR" ]] || die "release directory does not exist: $RELEASE_DIR"

install -d -m 0750 "$APP_DIR" "$RELEASES_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || die "another saliminn deployment is already running"

required_payload=(
  deploy.sh
  database-backup.sh
  docker-compose.prod.yml
  SHA256SUMS
  images/backend.tar.gz
  images/frontend.tar.gz
  initdb/01-v1-baseline.sql
  initdb/02-seed.sql
  database/apply-patches.sh
  database/patches/manifest.tsv
  database/patches/_begin.sql
  database/patches/_end.sql
  database/patches/0002_google_subject.sql
  database/patches/0003_payment_idempotency.sql
  database/patches/0004_booking_status_vocabulary.sql
  database/patches/0005_booking_status_enforcement.sql
  database/patches/0006_guest_role_isolation.sql
  database/patches/0007_manager_audit_read.sql
)
for payload in "${required_payload[@]}"; do
  [[ -f "$RELEASE_DIR/$payload" ]] || die "release payload is missing $payload"
done

(
  cd "$RELEASE_DIR"
  sha256sum --check SHA256SUMS
) || die "release checksum verification failed"

ensure_host_runtime() {
  [[ $(uname -m) == x86_64 ]] || die "this release targets the confirmed x86-64 Lightsail host"

  local packages=()
  command -v curl >/dev/null 2>&1 || packages+=(ca-certificates curl)
  command -v docker >/dev/null 2>&1 || packages+=(docker.io)
  command -v gzip >/dev/null 2>&1 || packages+=(gzip)
  command -v htpasswd >/dev/null 2>&1 || packages+=(apache2-utils)
  command -v logrotate >/dev/null 2>&1 || packages+=(logrotate)
  command -v openssl >/dev/null 2>&1 || packages+=(openssl)

  if (( ${#packages[@]} > 0 )); then
    log "Installing the Docker runtime prerequisites (first deployment only)"
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${packages[@]}"
  fi

  systemctl enable --now docker

  if docker compose version >/dev/null 2>&1; then
    COMPOSE_COMMAND=(docker compose)
  else
    log "Installing the pinned Docker Compose plugin (first deployment only)"
    local plugin_dir=/usr/local/lib/docker/cli-plugins
    local plugin_tmp
    install -d -m 0755 "$plugin_dir"
    plugin_tmp=$(mktemp "$plugin_dir/docker-compose.XXXXXX")
    curl --fail --silent --show-error --location \
      "https://github.com/docker/compose/releases/download/$COMPOSE_VERSION/docker-compose-linux-x86_64" \
      --output "$plugin_tmp"
    printf '%s  %s\n' "$COMPOSE_SHA256" "$plugin_tmp" | sha256sum --check --status - \
      || die "downloaded Docker Compose plugin failed checksum verification"
    chmod 0755 "$plugin_tmp"
    mv "$plugin_tmp" "$plugin_dir/docker-compose"
    docker compose version >/dev/null 2>&1 || die "Docker Compose plugin installation failed"
    COMPOSE_COMMAND=(docker compose)
  fi

  command -v caddy >/dev/null 2>&1 || die "host Caddy is missing; payroll currently depends on it, so install/repair it manually"
  [[ -f "$CADDY_FILE" ]] || die "host Caddyfile is missing: $CADDY_FILE"
}

ensure_capacity() {
  local available_kib
  available_kib=$(df --output=avail -k "$APP_DIR" | tail -n 1 | tr -d ' ')
  [[ "$available_kib" =~ ^[0-9]+$ ]] || die "could not determine free disk space"
  (( available_kib >= 6291456 )) \
    || die "at least 6 GiB of free disk is required for images, rollback, backup, and emergency swap"

  local swap_kib
  swap_kib=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)
  if (( swap_kib < 1048576 )); then
    local swap_file=/var/lib/saliminn.swap
    log "Adding 2 GiB of emergency swap because this shared VPS has less than 1 GiB configured"
    if [[ ! -f "$swap_file" ]]; then
      fallocate -l 2G "$swap_file"
      chmod 0600 "$swap_file"
      mkswap "$swap_file" >/dev/null
    fi
    swapon --show=NAME --noheadings | grep -Fxq "$swap_file" || swapon "$swap_file"
    grep -Fq "$swap_file none swap sw 0 0" /etc/fstab \
      || printf '%s none swap sw 0 0\n' "$swap_file" >> /etc/fstab
  fi
  printf 'vm.swappiness=10\n' > /etc/sysctl.d/99-saliminn-swap.conf
  sysctl -q -w vm.swappiness=10
}

ensure_secrets() {
  if [[ ! -f "$SECRETS_FILE" ]]; then
    log "Generating persistent database and JWT secrets on the VPS"
    local secrets_tmp
    secrets_tmp=$(mktemp "$APP_DIR/.secrets.env.XXXXXX")
    printf 'POSTGRES_PASSWORD=%s\nJWT_SECRET=%s\n' \
      "$(openssl rand -hex 32)" \
      "$(openssl rand -hex 48)" > "$secrets_tmp"
    chmod 0600 "$secrets_tmp"
    mv "$secrets_tmp" "$SECRETS_FILE"
  fi

  chmod 0600 "$SECRETS_FILE"
  set -a
  # This root-owned file is generated immediately above.
  # shellcheck disable=SC1090
  source "$SECRETS_FILE"
  set +a

  [[ "${POSTGRES_PASSWORD:-}" =~ ^[A-Za-z0-9._~-]{32,}$ ]] \
    || die "POSTGRES_PASSWORD in $SECRETS_FILE must be at least 32 URL-safe characters"
  local jwt_value=${JWT_SECRET:-}
  (( ${#jwt_value} >= 32 )) || die "JWT_SECRET in $SECRETS_FILE must be at least 32 characters"

  # SMTP is optional and deliberately never auto-generated: only the operator
  # can supply a real mailbox. Report the state loudly instead of failing, so a
  # deploy is never blocked by it -- but a half-configured pair is a mistake
  # worth stopping for, since it looks configured and silently sends nothing.
  if [[ -n "${SMTP_HOST:-}" && -n "${SMTP_FROM_EMAIL:-}" ]]; then
    log "Email delivery ENABLED (SMTP_HOST=${SMTP_HOST}, from=${SMTP_FROM_EMAIL})"
  elif [[ -n "${SMTP_HOST:-}" || -n "${SMTP_FROM_EMAIL:-}" ]]; then
    die "Incomplete SMTP config in $SECRETS_FILE: SMTP_HOST and SMTP_FROM_EMAIL must both be set (or both unset)"
  else
    log "Email delivery DISABLED (no SMTP_HOST/SMTP_FROM_EMAIL in $SECRETS_FILE)."
    log "  Guest email stays queued in email_deliveries and operational alerting cannot send."
    log "  To enable: append SMTP_HOST/SMTP_PORT/SMTP_USERNAME/SMTP_PASSWORD/SMTP_FROM_EMAIL to $SECRETS_FILE and redeploy."
  fi
}

install_release_files() {
  install -m 0644 "$RELEASE_DIR/docker-compose.prod.yml" "$COMPOSE_FILE"
  install -m 0750 "$RELEASE_DIR/deploy.sh" "$APP_DIR/deploy.sh"
  install -m 0750 "$RELEASE_DIR/database-backup.sh" "$APP_DIR/database-backup.sh"
  # The official PostgreSQL entrypoint processes these files as its non-root
  # postgres user, so this read-only directory must be traversable by it.
  install -d -m 0755 "$APP_DIR/initdb"
  install -m 0644 "$RELEASE_DIR/initdb/01-v1-baseline.sql" "$APP_DIR/initdb/01-v1-baseline.sql"
  install -m 0644 "$RELEASE_DIR/initdb/02-seed.sql" "$APP_DIR/initdb/02-seed.sql"
  install -d -m 0755 "$APP_DIR/database" "$APP_DIR/database/patches"
  install -m 0750 "$RELEASE_DIR/database/apply-patches.sh" "$APP_DIR/database/apply-patches.sh"
  install -m 0644 "$RELEASE_DIR/database/patches/manifest.tsv" "$APP_DIR/database/patches/manifest.tsv"
  install -m 0644 "$RELEASE_DIR/database/patches/_begin.sql" "$APP_DIR/database/patches/_begin.sql"
  install -m 0644 "$RELEASE_DIR/database/patches/_end.sql" "$APP_DIR/database/patches/_end.sql"
  install -m 0644 "$RELEASE_DIR/database/patches/0002_google_subject.sql" "$APP_DIR/database/patches/0002_google_subject.sql"
  install -m 0644 "$RELEASE_DIR/database/patches/0003_payment_idempotency.sql" "$APP_DIR/database/patches/0003_payment_idempotency.sql"
  install -m 0644 "$RELEASE_DIR/database/patches/0004_booking_status_vocabulary.sql" "$APP_DIR/database/patches/0004_booking_status_vocabulary.sql"
  install -m 0644 "$RELEASE_DIR/database/patches/0005_booking_status_enforcement.sql" "$APP_DIR/database/patches/0005_booking_status_enforcement.sql"
  install -m 0644 "$RELEASE_DIR/database/patches/0006_guest_role_isolation.sql" "$APP_DIR/database/patches/0006_guest_role_isolation.sql"
  install -m 0644 "$RELEASE_DIR/database/patches/0007_manager_audit_read.sql" "$APP_DIR/database/patches/0007_manager_audit_read.sql"

  # The backend image runs as uid/gid 1000. Bind-mounted application state must
  # stay writable by that non-root user across container replacements.
  install -d -m 0750 -o 1000 -g 1000 \
    "$APP_DIR/data" \
    "$APP_DIR/data/uploads" \
    "$APP_DIR/data/uploads/public" \
    "$APP_DIR/data/private_uploads" \
    "$APP_DIR/data/private_uploads/ekyc" \
    "$APP_DIR/logs"

  cat > /etc/logrotate.d/saliminn <<'LOGROTATE'
/opt/saliminn/logs/*.log {
    daily
    maxsize 10M
    rotate 7
    missingok
    notifempty
    compress
    delaycompress
    copytruncate
}
LOGROTATE
  chmod 0644 /etc/logrotate.d/saliminn
}

# Nightly database backups. Before this timer existed, dumps only ran inside
# the deploy sequence, so between deploys there was NO recovery point — a
# disk failure or a bad patch lost everything since the last deploy. The
# service runs the standalone backup script; journald captures its output.
install_backup_schedule() {
  cat > /etc/systemd/system/saliminn-backup.service <<'BACKUP_SERVICE'
[Unit]
Description=Saliminn nightly database backup
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/opt/saliminn/database-backup.sh
BACKUP_SERVICE

  # 18:10 UTC = 02:10 Malaysia time: the lowest-traffic window for a hotel.
  # Persistent=true runs a missed slot on boot (e.g. after maintenance).
  cat > /etc/systemd/system/saliminn-backup.timer <<'BACKUP_TIMER'
[Unit]
Description=Nightly Saliminn database backup schedule

[Timer]
OnCalendar=*-*-* 18:10:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
BACKUP_TIMER

  systemctl daemon-reload
  systemctl enable --now saliminn-backup.timer
}

load_release_images() {
  log "Loading application images for $TAG"
  gzip -dc "$RELEASE_DIR/images/backend.tar.gz" | docker load >/dev/null
  gzip -dc "$RELEASE_DIR/images/frontend.tar.gz" | docker load >/dev/null
  docker image inspect "saliminn-backend:$TAG" >/dev/null
  docker image inspect "saliminn-frontend:$TAG" >/dev/null
  [[ $(docker image inspect --format '{{.Architecture}}' "saliminn-backend:$TAG") == amd64 ]] \
    || die "backend image architecture is not amd64"
  [[ $(docker image inspect --format '{{.Architecture}}' "saliminn-frontend:$TAG") == amd64 ]] \
    || die "frontend image architecture is not amd64"

  if ! docker image inspect "$POSTGRES_IMAGE" >/dev/null 2>&1; then
    log "Pulling $POSTGRES_IMAGE (first deployment only)"
    docker pull "$POSTGRES_IMAGE" >/dev/null
  fi
}

compose() {
  "${COMPOSE_COMMAND[@]}" \
    --project-name saliminn \
    --file "$COMPOSE_FILE" \
    "$@"
}

container_health() {
  docker inspect \
    --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$1" 2>/dev/null || true
}

wait_for_healthy() {
  local container=$1
  local deadline=$((SECONDS + 240))
  local status
  while (( SECONDS < deadline )); do
    status=$(container_health "$container")
    case "$status" in
      healthy)
        log "$container is healthy"
        return 0
        ;;
      exited|dead|unhealthy)
        log "$container entered state: $status"
        return 1
        ;;
    esac
    sleep 3
  done
  log "$container did not become healthy before the timeout (last state: ${status:-missing})"
  return 1
}

wait_for_database_baseline() {
  local deadline=$((SECONDS + 240))
  local baseline_revision
  while (( SECONDS < deadline )); do
    if docker exec saliminn-db pg_isready -h 127.0.0.1 -U hotel_admin -d hotel_management \
      >/dev/null 2>&1; then
      baseline_revision=$(docker exec saliminn-db sh -c \
        'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -h 127.0.0.1 -U hotel_admin -d hotel_management -X -Atqc "$1"' \
        sh 'SELECT 1 FROM public.hotel_schema_revisions WHERE generation = 1 AND version = 1;' \
        2>/dev/null || true)
      if [[ "$baseline_revision" == 1 ]]; then
        log "saliminn-db final TCP server has the V1 baseline"
        return 0
      fi
    fi
    sleep 3
  done
  log "saliminn-db final TCP server with V1 baseline did not become ready before the timeout"
  return 1
}

start_database_for_release() {
  local compose_tag=${1:-$TAG}
  export IMAGE_TAG=$compose_tag
  compose config >/dev/null
  # Preserve the live database container until its verified backup and patching succeed.
  # On first install --no-recreate still creates the missing PostgreSQL service.
  compose up --detach --no-recreate postgres
  wait_for_healthy saliminn-db
  wait_for_database_baseline
}

apply_database_patches_for_release() {
  "$APP_DIR/database/apply-patches.sh" \
    --container saliminn-db \
    --user hotel_admin \
    --database hotel_management
}

deploy_tag() {
  local target_tag=$1
  export IMAGE_TAG=$target_tag
  compose config >/dev/null || return 1
  compose up --detach --remove-orphans || return 1
  wait_for_healthy saliminn-db || return 1
  wait_for_healthy saliminn-backend || return 1
  wait_for_healthy saliminn-frontend || return 1
  curl -fsS http://127.0.0.1:3030/health >/dev/null || return 1
  curl -fsS http://127.0.0.1:8081/health >/dev/null || return 1
}

show_diagnostics() {
  compose ps >&2 || true
  compose logs --no-color --tail 100 postgres backend frontend >&2 || true
}

backup_existing_database() {
  install -d -m 0700 "$BACKUP_DIR"
  local timestamp backup_tmp backup_path
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  backup_path="$BACKUP_DIR/predeploy-$timestamp.dump"
  backup_tmp=$(mktemp "$BACKUP_DIR/.predeploy.XXXXXX")
  log "Creating local pre-deploy database backup"
  if docker exec saliminn-db \
    pg_dump --format=custom --no-owner --no-acl -U hotel_admin hotel_management \
    > "$backup_tmp" \
    && docker exec -i saliminn-db pg_restore --list < "$backup_tmp" >/dev/null; then
    chmod 0600 "$backup_tmp"
    mv "$backup_tmp" "$backup_path"
  else
    rm -f "$backup_tmp"
    die "database backup failed; refusing to deploy"
  fi

  local backups=() index
  mapfile -t backups < <(
    find "$BACKUP_DIR" -maxdepth 1 -type f -name 'predeploy-*.dump' -printf '%T@ %p\n' \
      | sort -nr \
      | cut -d' ' -f2-
  )
  for ((index = 3; index < ${#backups[@]}; index++)); do
    rm -f -- "${backups[$index]}"
  done
}

ensure_initial_admin_password() {
  local placeholder_hash current_hash password password_hash updated password_tmp
  placeholder_hash="\$2b\$12\$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK"
  current_hash=$(docker exec saliminn-db \
    psql -U hotel_admin -d hotel_management --tuples-only --no-align \
      --command "SELECT password_hash FROM users WHERE username = 'admin'" \
    | tr -d '[:space:]')

  [[ -n "$current_hash" ]] || return 1
  if [[ "$current_hash" != "$placeholder_hash" ]]; then
    if [[ ! -f "$ADMIN_PASSWORD_MARKER" ]]; then
      log "Existing non-placeholder admin password was preserved"
      printf 'existing admin password preserved at %s\n' "$(date -u +%FT%TZ)" > "$ADMIN_PASSWORD_MARKER"
      chmod 0600 "$ADMIN_PASSWORD_MARKER"
    fi
    return 0
  fi

  password=$(openssl rand -hex 20) || return 1
  password_hash=$(htpasswd -bnBC 12 '' "$password" | tr -d ':\n') || return 1
  password_hash=${password_hash/#\$2y\$/\$2b\$}

  # Atomically publish and durably flush the credential before activating its
  # hash. A power loss after the database update must not make the only usable
  # initial-admin password unrecoverable.
  password_tmp=$(mktemp "$APP_DIR/.initial-admin-password.XXXXXX") || return 1
  if ! printf 'username=admin\npassword=%s\n' "$password" > "$password_tmp"; then
    rm -f -- "$password_tmp"
    return 1
  fi
  if ! chmod 0600 "$password_tmp" || ! mv "$password_tmp" "$ADMIN_PASSWORD_FILE"; then
    rm -f -- "$password_tmp"
    return 1
  fi
  sync --file-system "$APP_DIR" || return 1

  updated=$(docker exec -i saliminn-db \
    psql -U hotel_admin -d hotel_management --tuples-only --no-align \
      --set=password_hash="$password_hash" <<'SQL'
WITH changed AS (
    UPDATE users
       SET password_hash = :'password_hash', updated_at = CURRENT_TIMESTAMP
     WHERE username = 'admin'
     RETURNING 1
)
SELECT COUNT(*) FROM changed;
SQL
  )
  [[ $(printf '%s' "$updated" | tr -d '[:space:]') == 1 ]] || return 1

  printf 'generated at %s\n' "$(date -u +%FT%TZ)" > "$ADMIN_PASSWORD_MARKER"
  chmod 0600 "$ADMIN_PASSWORD_MARKER"
  log "A one-time admin credential was written to $ADMIN_PASSWORD_FILE (root-only)"
}

configure_caddy() {
  local site_tmp main_backup site_backup=""
  site_tmp=$(mktemp "$APP_DIR/.saliminn.Caddyfile.XXXXXX")
  main_backup=$(mktemp "$APP_DIR/.Caddyfile.XXXXXX")
  cp -p "$CADDY_FILE" "$main_backup"
  if [[ -f "$CADDY_SITE_FILE" ]]; then
    site_backup=$(mktemp "$APP_DIR/.saliminn.Caddyfile.previous.XXXXXX")
    cp -p "$CADDY_SITE_FILE" "$site_backup"
  fi

  cat > "$site_tmp" <<'CADDY'
saliminn.my {
    encode zstd gzip

    # Force HTTPS on repeat visits (prevents SSL-strip downgrade). Set-if-missing
    # so an upstream that also emits HSTS is not duplicated.
    header ?Strict-Transport-Security "max-age=31536000; includeSubDomains"

    # Access log. The application cannot produce one: its TraceLayer spans are
    # emitted at DEBUG while the backend container runs RUST_LOG=warn, and
    # raising that would log every SQL statement (including guest PII) into a
    # file with no rotation. Caddy is the only layer that sees every request,
    # including ones the backend never routes (404 sweeps, path traversal
    # probes, scanner traffic).
    #
    # No `output` directive on purpose: Caddy then writes to stderr, which
    # systemd captures into the journal (`journalctl -u caddy`). An earlier
    # revision used `output file /var/log/caddy/...` and broke the deploy —
    # `caddy validate` passes as root without ever opening the sink, but the
    # service runs as the `caddy` user and aborts if it cannot write the file,
    # so the reload failed with "Job for caddy.service failed". stderr needs no
    # directory, no ownership, and no systemd ReadWritePaths entry, and journald
    # already handles rotation and retention.
    log {
        format json
    }

    @backend path /api /api/* /uploads /uploads/* /health /ws /ws/*
    handle @backend {
        # Replace — never append to — any client-supplied X-Forwarded-For so
        # the backend's right-to-left parse sees only this proxy's view of the
        # peer. Appending would let one host rotate spoofed IPs per request
        # and bypass every per-IP rate limiter.
        reverse_proxy 127.0.0.1:3030 {
            header_up X-Forwarded-For {remote_host}
        }
    }

    handle {
        reverse_proxy 127.0.0.1:8081
    }
}

www.saliminn.my {
    redir https://saliminn.my{uri} permanent
}
CADDY

  install -m 0644 "$site_tmp" "$CADDY_SITE_FILE"
  if ! grep -Fqx "import $CADDY_SITE_FILE" "$CADDY_FILE"; then
    printf '\n# Hotel application (managed by /opt/saliminn/deploy.sh)\nimport %s\n' \
      "$CADDY_SITE_FILE" >> "$CADDY_FILE"
  fi

  if ! caddy validate --config "$CADDY_FILE"; then
    cp -p "$main_backup" "$CADDY_FILE"
    if [[ -n "$site_backup" ]]; then
      cp -p "$site_backup" "$CADDY_SITE_FILE"
    else
      rm -f "$CADDY_SITE_FILE"
    fi
    rm -f "$site_tmp" "$main_backup"
    [[ -z "$site_backup" ]] || rm -f "$site_backup"
    return 1
  fi

  if ! systemctl reload caddy; then
    cp -p "$main_backup" "$CADDY_FILE"
    if [[ -n "$site_backup" ]]; then
      cp -p "$site_backup" "$CADDY_SITE_FILE"
    else
      rm -f "$CADDY_SITE_FILE"
    fi
    systemctl reload caddy || true
    rm -f "$site_tmp" "$main_backup"
    [[ -z "$site_backup" ]] || rm -f "$site_backup"
    return 1
  fi

  rm -f "$site_tmp" "$main_backup"
  [[ -z "$site_backup" ]] || rm -f "$site_backup"
}

cleanup_old_releases() {
  local keep_current=$1 keep_previous=$2 directory basename
  for directory in "$RELEASES_DIR"/*; do
    [[ -d "$directory" ]] || continue
    basename=${directory##*/}
    if [[ "$basename" != "$keep_current" && "$basename" != "$keep_previous" ]]; then
      rm -rf -- "$directory"
    fi
  done
}

cleanup_old_images() {
  local repository=$1 keep_current=$2 keep_previous=$3 image_tag
  while IFS= read -r image_tag; do
    [[ -n "$image_tag" && "$image_tag" != '<none>' ]] || continue
    if [[ "$image_tag" != "$keep_current" && "$image_tag" != "$keep_previous" ]]; then
      docker image rm "$repository:$image_tag" >/dev/null 2>&1 || true
    fi
  done < <(docker image ls "$repository" --format '{{.Tag}}')
}

ensure_host_runtime
ensure_capacity
ensure_secrets

previous_tag=""
if [[ -s "$CURRENT_TAG_FILE" ]]; then
  read -r previous_tag < "$CURRENT_TAG_FILE"
  if [[ ! "$previous_tag" =~ ^[0-9a-f]{40}$ ]]; then
    log "Ignoring malformed previous release marker"
    previous_tag=""
  fi
fi

install_release_files
install_backup_schedule
load_release_images
start_database_for_release "$TAG"
backup_existing_database
apply_database_patches_for_release

log "Starting release $TAG"
if deploy_tag "$TAG" && ensure_initial_admin_password && configure_caddy; then
  printf '%s\n' "$TAG" > "$CURRENT_TAG_FILE"
  chmod 0600 "$CURRENT_TAG_FILE"
  cleanup_old_images saliminn-backend "$TAG" "$previous_tag"
  cleanup_old_images saliminn-frontend "$TAG" "$previous_tag"
  cleanup_old_releases "$TAG" "$previous_tag"
  log "Release $TAG is healthy on localhost:3030 and localhost:8081"
  log "Caddy is configured for https://saliminn.my"
  exit 0
fi

log "Release $TAG failed; collecting diagnostics"
export IMAGE_TAG=$TAG
show_diagnostics

if [[ -n "$previous_tag" ]] \
  && docker image inspect "saliminn-backend:$previous_tag" >/dev/null 2>&1 \
  && docker image inspect "saliminn-frontend:$previous_tag" >/dev/null 2>&1; then
  log "Rolling application containers back to $previous_tag"
  if [[ -f "$RELEASES_DIR/$previous_tag/docker-compose.prod.yml" ]]; then
    install -m 0644 "$RELEASES_DIR/$previous_tag/docker-compose.prod.yml" "$COMPOSE_FILE"
  fi
  if deploy_tag "$previous_tag"; then
    log "Rollback succeeded"
  else
    log "Rollback failed; manual intervention is required"
    show_diagnostics
  fi
else
  log "No complete previous release is available for automatic rollback"
  compose stop backend frontend >/dev/null 2>&1 || true
fi

die "deployment failed"
