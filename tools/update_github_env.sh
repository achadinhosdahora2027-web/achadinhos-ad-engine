#!/bin/sh
# Nexus v1555.0 — authenticated, fast-forward-only GitHub publication.
#
# Required environment:
#   GITHUB_PAT       repository-scoped token with Contents: write
# Optional:
#   GITHUB_BRANCH    defaults to main
#
# The PAT is never written to Git config, the repository, Supabase, or logs.
# GitHub credentials and nexus_satellites_kms protect different trust domains;
# this script intentionally does not mix them.
set -eu

: "${GITHUB_PAT:?GITHUB_PAT is required}"
branch="${GITHUB_BRANCH:-main}"
repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

case "$branch" in
  *[!A-Za-z0-9._/-]*|'') echo "invalid GITHUB_BRANCH" >&2; exit 2 ;;
esac

askpass=$(mktemp "${TMPDIR:-/tmp}/nexus-git-askpass.XXXXXX")
cleanup() {
  rm -f "$askpass"
  unset GIT_ASKPASS GITHUB_PAT
}
trap cleanup EXIT HUP INT TERM
chmod 700 "$askpass"
cat >"$askpass" <<'ASKPASS'
#!/bin/sh
case "$1" in
  *sername*) printf '%s\n' 'x-access-token' ;;
  *assword*) printf '%s\n' "$GITHUB_PAT" ;;
  *) exit 1 ;;
esac
ASKPASS

export GIT_ASKPASS="$askpass"
export GIT_TERMINAL_PROMPT=0

git fetch origin "$branch"
if ! git merge-base --is-ancestor "origin/$branch" "$branch"; then
  echo "refusing non-fast-forward publication; merge/rebase origin/$branch first" >&2
  exit 3
fi

git push origin "$branch"
printf 'published %s at %s\n' "$branch" "$(git rev-parse HEAD)"
