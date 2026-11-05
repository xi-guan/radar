set shell := ["bash", "-euo", "pipefail", "-c"]

PORT := "9280"
INSTALL_PATH := "/usr/local/bin/kubectl-radar"

[private]
_default:
    @just --list --unsorted --list-heading '' --list-prefix='- '

# sync fork with upstream, then rebase local changes
pull:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "→ syncing fork with upstream"
    gh repo sync xi-guan/radar --source skyhook-io/radar
    echo "→ pulling from origin with rebase"
    git pull --rebase --autostash origin main
    echo "✓ pull complete"

# install Go + npm dependencies and dev tools
setup:
    #!/usr/bin/env bash
    set -euo pipefail
    log=$(mktemp); trap 'rm -f "$log"' EXIT
    run_quiet() {
        local label="$1"; shift
        echo "→ $label"
        "$@" >"$log" 2>&1 || { local rc=$?; echo "✗ $label failed:" >&2; cat "$log" >&2; exit $rc; }
    }
    run_quiet "downloading go modules" go mod download
    run_quiet "installing npm dependencies" npm install
    if ! command -v air >/dev/null 2>&1; then
        run_quiet "installing air (Go hot reload)" go install github.com/air-verse/air@latest
    fi
    echo "✓ setup complete"

# build and install kubectl-radar to /usr/local/bin
install:
    #!/usr/bin/env bash
    set -euo pipefail
    log=$(mktemp); trap 'rm -f "$log"' EXIT
    run_quiet() {
        local label="$1"; shift
        echo "→ $label"
        "$@" >"$log" 2>&1 || { local rc=$?; echo "✗ $label failed:" >&2; cat "$log" >&2; exit $rc; }
    }
    run_quiet "building frontend" bash -c 'cd web && npm run build'
    echo "→ embedding frontend"
    rm -rf internal/static/dist
    mkdir -p internal/static/dist
    cp -r web/dist/* internal/static/dist/
    run_quiet "building binary" go build -ldflags "-X main.version=$(git describe --tags --always --dirty 2>/dev/null || echo dev)" -o radar ./cmd/explorer
    if [[ -e "{{ INSTALL_PATH }}" ]]; then
        archive_dir="$HOME/.cache/radar/versions"
        mkdir -p "$archive_dir"
        prev_version=$("{{ INSTALL_PATH }}" version 2>/dev/null | head -1 | tr -c 'a-zA-Z0-9._-' '_' || echo "unknown")
        archive_path="$archive_dir/kubectl-radar-${prev_version}-$(date +%s)"
        echo "→ archiving previous install to $archive_path (rollback via: just install-rollback)"
        cp "{{ INSTALL_PATH }}" "$archive_path"
    fi
    echo "→ installing to {{ INSTALL_PATH }}"
    cp radar "{{ INSTALL_PATH }}" || sudo cp radar "{{ INSTALL_PATH }}"
    echo "✓ installed — run 'kubectl radar' or 'kubectl-radar'"

# restore a previously archived kubectl-radar binary
[private]
install-rollback:
    #!/usr/bin/env bash
    set -euo pipefail
    command -v fzf >/dev/null || { echo "fzf required: brew install fzf"; exit 1; }
    archive_dir="$HOME/.cache/radar/versions"
    [[ -d "$archive_dir" ]] && [[ -n "$(ls -A "$archive_dir" 2>/dev/null)" ]] || { echo "No archived versions to roll back to."; exit 0; }
    sel=$(ls -t "$archive_dir" | fzf --header="Select version to restore" --preview="file $archive_dir/{}")
    [[ -n "$sel" ]] || exit 0
    read -r -p "Restore $sel over {{ INSTALL_PATH }}? [y/N] " confirm
    [[ "$confirm" == "y" || "$confirm" == "Y" ]] || exit 0
    cp "$archive_dir/$sel" "{{ INSTALL_PATH }}" || sudo cp "$archive_dir/$sel" "{{ INSTALL_PATH }}"
    echo "✓ restored $sel"

# remove kubectl-radar and local build artifacts
uninstall:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -e "{{ INSTALL_PATH }}" ]]; then
        echo "→ removing {{ INSTALL_PATH }}"
        rm -f "{{ INSTALL_PATH }}" || sudo rm -f "{{ INSTALL_PATH }}"
    fi
    echo "→ removing local build artifacts"
    rm -f radar radar-desktop
    rm -rf web/dist node_modules web/node_modules packages/*/node_modules
    rm -rf internal/static/dist
    mkdir -p internal/static/dist && touch internal/static/dist/.gitkeep
    echo "✓ uninstall complete"

# remove environment + reinstall from scratch
reinstall: uninstall setup install

# hot-reload dev servers (Vite :9273 + Go/air :9280)
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "→ starting Vite dev server on :9273"
    (cd web && npm run dev) &
    vite_pid=$!
    trap 'kill "$vite_pid" 2>/dev/null || true' EXIT
    echo "→ starting air (Go hot reload) on :{{ PORT }}"
    command -v air >/dev/null 2>&1 || { echo "air not found — run: just setup"; exit 1; }
    air

# build once and run the binary
run:
    #!/usr/bin/env bash
    set -euo pipefail
    log=$(mktemp); trap 'rm -f "$log"' EXIT
    run_quiet() {
        local label="$1"; shift
        echo "→ $label"
        "$@" >"$log" 2>&1 || { local rc=$?; echo "✗ $label failed:" >&2; cat "$log" >&2; exit $rc; }
    }
    run_quiet "building frontend" bash -c 'cd web && npm run build'
    echo "→ embedding frontend"
    rm -rf internal/static/dist
    mkdir -p internal/static/dist
    cp -r web/dist/* internal/static/dist/
    run_quiet "building binary" go build -o radar ./cmd/explorer
    echo "✓ starting radar on :{{ PORT }}"
    ./radar --kubeconfig ~/.kube/config --port {{ PORT }}

# stop the running radar server
stop:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "→ stopping radar on :{{ PORT }}"
    lsof -ti:{{ PORT }} | xargs kill -9 2>/dev/null || true
    pkill -9 -f './radar' 2>/dev/null || true
    echo "✓ stopped"

# build + push fork image, deploy to a dcsp sandbox (k3d | z600) via gitea + flux
deploy-sandbox target tag="":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{ target }}" in
        k3d)  ctx="k3d-dcsp";  arch="arm64"; branch="k3d" ;;
        z600) ctx="z600-dcsp"; arch="amd64"; branch="main" ;;
        *) echo "✗ unknown target '{{ target }}' (expected k3d or z600)" >&2; exit 1 ;;
    esac
    sandbox="$HOME/volvo/dcsp-readonly/_k8s-flux-sandbox"
    source "$sandbox/_scripts/registry-auth.sh"
    radar_yaml="infrastructure/base/controllers/radar.yaml"
    tag="{{ tag }}"
    [[ -n "$tag" ]] || tag="$(date +%Y%m%d-%H%M)"
    image="gitea.susie.se/dcsp/radar:$tag"
    chart="$(git describe --tags --match 'v[0-9]*' --exclude '*-*' --abbrev=0)"
    chart="${chart#v}"
    # the sandbox checkout is often behind gitea or dirty, so the bump is committed from a throwaway worktree
    wt="$(mktemp -d)/sandbox"
    log=$(mktemp); trap 'rm -f "$log"; git -C "$sandbox" worktree remove --force "$wt" 2>/dev/null || true; rmdir "${wt%/*}"; registry_cleanup' EXIT
    curl -fsSL https://skyhook-io.github.io/helm-charts/index.yaml | yq '.entries.radar[].version' | grep -x "$chart" >/dev/null \
        || { echo "✗ chart radar $chart is not in the skyhook helm repo yet" >&2; exit 1; }
    registry_login || { echo "✗ gitea registry login failed — check keychain item dcsp-package" >&2; exit 1; }
    echo "→ building $image ($arch)"
    # both flags required: DOCKER_DEFAULT_PLATFORM=amd64 in env, and the
    # Dockerfile's ARG TARGETARCH=amd64 default overrides --platform alone
    docker build --platform "linux/$arch" --build-arg TARGETARCH="$arch" \
        --build-arg VERSION="$tag" --target full -t "$image" . >"$log" 2>&1 \
        || { cat "$log" >&2; exit 1; }
    grep -q "GOARCH=$arch" "$log" || { echo "✗ binary is not $arch (no GOARCH=$arch in build log) — do not trust the manifest"; exit 1; }
    echo "→ pushing $image"
    docker push "$image" >"$log" 2>&1 || { cat "$log" >&2; exit 1; }
    echo "→ bumping $radar_yaml on gitea/$branch (tag $tag, chart $chart)"
    git -C "$sandbox" fetch -q gitea "$branch"
    git -C "$sandbox" worktree add -q --detach "$wt" "gitea/$branch"
    sed -i '' -e "s|tag: \".*\"|tag: \"$tag\"|" -e "s|^\( *\)version: \".*\"|\1version: \"$chart\"|" "$wt/$radar_yaml"
    if git -C "$wt" diff --quiet -- "$radar_yaml"; then
        echo "⚠ $radar_yaml unchanged — skipping commit (the cluster will not re-pull an existing tag)"
    else
        git -C "$wt" commit -q -m "radar: bump to $tag, chart $chart" -- "$radar_yaml"
        git -C "$wt" push -q gitea "HEAD:$branch"
    fi
    echo "→ flux reconcile ($ctx)"
    flux --context "$ctx" reconcile source git flux-system -n flux-system
    flux --context "$ctx" reconcile kustomization base-controllers -n base
    flux --context "$ctx" reconcile helmrelease radar -n base
    kubectl --context "$ctx" -n base rollout status deploy/radar --timeout=120s
    kubectl --context "$ctx" -n base get pods -l app.kubernetes.io/name=radar \
        -o jsonpath='{range .items[*]}{.spec.containers[0].image}{"  "}{.status.phase}{"\n"}{end}'
    echo "✓ deployed $tag"
