#!/usr/bin/env bash
# Export the live Home sources into the GitHub repo (~/home-repo) and push only if clean.
# Source of truth: ~/home-automation (app git repo + infra). The export repo gets one commit per
# sync ("sync: app@<sha>"). Personal strings are redacted with secrets/redact.txt (never committed),
# then the staged tree is checked with gitleaks + secrets/redact.grep before commit/push.
set -euo pipefail
ROOT=${HOME_ROOT:-$HOME/home-automation}; REPO=${HOME_REPO:-$HOME/home-repo}
RULES=$ROOT/secrets/redact.txt; GREP=$ROOT/secrets/redact.grep
export PATH="$HOME/.local/bin:/usr/bin:/bin:$PATH"
exec 9>/tmp/home-repo-sync.lock; flock -n 9 || { echo "another sync running"; exit 0; }
[ -r "$RULES" ] && [ -r "$GREP" ] || { echo "redaction rules missing; refusing to export"; exit 1; }
cd "$REPO"
[ -z "$(git status --porcelain)" ] || { echo "export repo dirty (previous failed check?) - fix manually"; exit 1; }
APPSHA=$(git -C "$ROOT/app" rev-parse --short HEAD)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
git -C "$ROOT/app" archive HEAD | tar -x -C "$TMP"
rsync -a --delete --exclude screenshots/ "$TMP/" app/
cp "$ROOT/AUTOMATIONS.md" "$ROOT/FAILOVER.md" "$ROOT/GROK_CLI_PLAN.md" docs/
cp "$ROOT/README.md" docs/INFRA_README.md
cp "$ROOT/docker-compose.yml" .
cp "$ROOT/grok-assistant/prompts/home.md" grok-assistant/prompts/home.md
rsync -a --delete --exclude '*.log' "$ROOT/failover/" infra/failover/
rsync -a --delete --include 'home-*.service' --include 'home-*.timer' --exclude '*' "$HOME/.config/systemd/user/" infra/systemd/
rsync -a --delete --include '*.py' --include '*.sh' --exclude '*' "$ROOT/tools/" infra/tools/
for f in automations.yaml configuration.yaml scenes.yaml scripts.yaml; do cp "$ROOT/ha-config/$f" ha-config/; done
rsync -a --delete --include '*/' --include '*.yaml' --exclude '*' "$ROOT/ha-config/packages/" ha-config/packages/
cp "$ROOT"/st_rename.py "$ROOT"/st_rename_undo.py "$ROOT"/smartthings-rename.plan.json "$ROOT"/smartthings-rename.undo.json scripts/
git add -A
# redact staged text files in place (same rules used for the one-time history purge)
git diff --cached --name-only -z --diff-filter=AM | python3 -c '
import sys, re
rules = []
for line in open(sys.argv[1], encoding="utf-8"):
    line = line.rstrip("\n")
    if not line or "==>" not in line: continue
    a, b = line.split("==>", 1)
    rules.append((re.compile(a[6:]) if a.startswith("regex:") else re.compile(re.escape(a)), b))
for p in sys.stdin.read().split("\0"):
    if not p: continue
    try: s = open(p, encoding="utf-8").read()
    except (UnicodeDecodeError, IsADirectoryError, FileNotFoundError): continue
    t = s
    for r, b in rules: t = r.sub(b, t)
    if t != s: open(p, "w", encoding="utf-8").write(t)
' "$RULES"
git add -A
if git diff --cached --quiet; then echo "nothing to sync (app@$APPSHA)"; exit 0; fi
fail() { echo "CHECK FAILED: $1 - not committing"; git reset -q; git checkout -q -- .; git clean -fdq; exit 1; }
# 1) forbidden paths
git diff --cached --name-only | grep -E '(^|/)(secrets|data)/|\.db($|-)|\.env($|\.)|family\.json$|config\.toml$|\.(pem|key|p12)$' | grep -v '\.example' && fail "forbidden path staged"
# 2) personal strings anywhere in the staged tree
if git grep --cached -I -n -P -f "$GREP" >/dev/null 2>&1; then fail "personal string in tree"; fi
# 3) secrets
git diff --cached --name-only -z --diff-filter=AM | xargs -0 -I{} sh -c 'mkdir -p "$0/$(dirname "{}")" && git show ":{}" > "$0/{}"' "$TMP/scan"
gitleaks dir --no-banner --redact -l error "$TMP/scan" >/dev/null 2>&1 || fail "gitleaks finding"
git commit -q -m "sync: app@$APPSHA ($(git -C "$ROOT/app" log -1 --format=%s | cut -c1-80 | python3 -c 'import sys,re
s=sys.stdin.read().strip()
for l in open(sys.argv[1],encoding="utf-8"):
  l=l.rstrip("\n")
  if "==>" in l:
    a,b=l.split("==>",1); s=re.sub(a[6:],b,s) if a.startswith("regex:") else s.replace(a,b)
print(s)' "$RULES"))"
if git push -q origin HEAD:main 2>"$TMP/push.err"; then echo "pushed $(git rev-parse --short HEAD) (app@$APPSHA)";
else echo "push rejected (history rewrite awaiting force-push approval?):"; sed 's/^/  /' "$TMP/push.err"; fi
