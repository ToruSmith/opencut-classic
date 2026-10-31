#!/usr/bin/env bash
# Runs the same checks on this branch and on origin/main so that pre-existing
# failures can be told apart from ones this branch introduces. Never fails by
# itself; compound-report.py decides.
set -u

OUT="${RUNNER_TEMP:-/tmp}/compound-verify"
mkdir -p "$OUT"
ROOT="$(pwd)"

CHANGED_FILES="$(git diff --name-only --diff-filter=AM origin/main...HEAD -- 'apps/web/src/*.ts' 'apps/web/src/*.tsx' | sed 's#^apps/web/##')"
printf '%s\n' "$CHANGED_FILES" > "$OUT/changed-files.txt"

run_checks() {
	local label="$1" dir="$2"
	(
		cd "$dir/apps/web" || exit 1
		timeout 900 bunx tsc --noEmit -p tsconfig.json > "$OUT/tsc-$label.log" 2>&1
		echo $? > "$OUT/tsc-$label.code"

		timeout 900 bun test > "$OUT/test-$label.log" 2>&1
		echo $? > "$OUT/test-$label.code"

		# Lint only the files this branch touches, on both sides.
		local files=()
		while IFS= read -r f; do [ -n "$f" ] && [ -f "$f" ] && files+=("$f"); done < "$OUT/changed-files.txt"
		if [ ${#files[@]} -gt 0 ]; then
			timeout 900 bunx eslint --no-warn-ignored -c "$dir/eslint.config.mjs" "${files[@]}" > "$OUT/eslint-$label.log" 2>&1
			echo $? > "$OUT/eslint-$label.code"
		else
			echo "no files" > "$OUT/eslint-$label.log"; echo 0 > "$OUT/eslint-$label.code"
		fi

		timeout 1800 bun run build > "$OUT/build-$label.log" 2>&1
		echo $? > "$OUT/build-$label.code"
	)
}

run_checks branch "$ROOT"

MAIN_DIR="${RUNNER_TEMP:-/tmp}/main-worktree"
git worktree add --detach "$MAIN_DIR" origin/main > /dev/null 2>&1
# Same lockfile on both sides, so share the installed dependencies.
ln -s "$ROOT/node_modules" "$MAIN_DIR/node_modules"
[ -d "$ROOT/apps/web/node_modules" ] && ln -s "$ROOT/apps/web/node_modules" "$MAIN_DIR/apps/web/node_modules"
run_checks main "$MAIN_DIR"

exit 0
