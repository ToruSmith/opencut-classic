"""Compare branch vs main results from compound-verify.sh and report them as
annotations (readable through the check-runs API even when raw logs are not).
Fails only on problems this branch introduces."""

import os
import re
from pathlib import Path

OUT = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / "compound-verify"
MAX = 6000


def read(name: str) -> str:
    path = OUT / name
    return path.read_text(errors="replace") if path.exists() else ""


def code(name: str) -> str:
    return read(f"{name}.code").strip() or "missing"


def esc(text: str) -> str:
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def annotate(level: str, title: str, body: str) -> None:
    body = body.strip() or "(empty)"
    if len(body) > MAX:
        body = body[:MAX] + "\n... (truncated)"
    print(f"::{level} title={title}::{esc(body)}")


def tail(text: str, lines: int) -> str:
    return "\n".join(text.strip().splitlines()[-lines:])


def tsc_errors(text: str) -> set[str]:
    errors = set()
    for line in text.splitlines():
        if "error TS" in line:
            errors.add(re.sub(r"\(\d+,\d+\)", "", line.strip()))
    return errors


def test_failures(text: str) -> set[str]:
    return {
        re.sub(r"\s*\[[\d.]+m?s\]$", "", line.strip())
        for line in text.splitlines()
        if line.strip().startswith("(fail)")
    }


def test_counts(text: str) -> str:
    found = re.findall(r"^\s*(\d+ (?:pass|fail|errors?))\s*$", text, re.M)
    return ", ".join(found) or "no summary"


problems: list[str] = []

# 1. Overview
overview = "\n".join(
    f"{check:<7} branch={code(check + '-branch'):<8} main={code(check + '-main')}"
    for check in ("tsc", "test", "eslint", "build")
)
overview += (
    f"\n\ntests branch: {test_counts(read('test-branch.log'))}"
    f"\ntests main:   {test_counts(read('test-main.log'))}"
)
annotate("notice", "Overview (exit codes)", overview)

# 2. Typecheck
new_tsc = sorted(tsc_errors(read("tsc-branch.log")) - tsc_errors(read("tsc-main.log")))
if new_tsc:
    problems.append(f"{len(new_tsc)} new type errors")
    annotate("error", f"New type errors ({len(new_tsc)})", "\n".join(new_tsc))
else:
    annotate(
        "notice",
        "Typecheck",
        f"No new type errors. main has {len(tsc_errors(read('tsc-main.log')))}.",
    )

# 3. Tests
branch_fail = test_failures(read("test-branch.log"))
main_fail = test_failures(read("test-main.log"))
new_fail = sorted(branch_fail - main_fail)
compound_log = [
    line
    for line in read("test-branch.log").splitlines()
    if "compound" in line.lower() and ("(fail)" in line or "(pass)" in line)
]
if new_fail:
    problems.append(f"{len(new_fail)} new test failures")
    annotate("error", f"New test failures ({len(new_fail)})", "\n".join(new_fail))
annotate(
    "notice",
    "Tests",
    f"branch: {test_counts(read('test-branch.log'))}\n"
    f"main:   {test_counts(read('test-main.log'))}\n"
    f"failing on both: {len(branch_fail & main_fail)}\n"
    f"fixed by branch: {len(main_fail - branch_fail)}\n\n"
    + ("\n".join(compound_log) or "no compound test lines found\n" + tail(read("test-branch.log"), 40)),
)

# 3b. Error details from the branch test run (load failures, assertions)
lines = read("test-branch.log").splitlines()
details = []
for i, line in enumerate(lines):
    if (
        "compound" in line.lower()
        or line.strip().startswith(("error:", "TypeError", "SyntaxError", "ReferenceError", "# Unhandled"))
        or "Expected" in line
        or "Received" in line
    ):
        details.extend(lines[max(0, i - 2) : i + 6])
        details.append("---")
annotate("notice", "Test error details (branch)", "\n".join(details[:400]))

annotate("notice", "Compound tests alone (branch)", tail(read("compound-branch.log"), 120))

# 4. Lint (only files this branch touches)
if code("eslint-branch") != "0":
    annotate(
        "warning",
        "ESLint on changed files (branch)",
        tail(read("eslint-branch.log"), 80)
        + f"\n\nmain exit code for the same files: {code('eslint-main')}",
    )
else:
    annotate("notice", "ESLint", "Changed files are clean.")

# 5. Build
if code("build-branch") != "0":
    if code("build-main") == "0" and code("build-branch") != "0":
        problems.append("build fails on branch but passes on main")
    annotate("error" if code("build-main") == "0" else "warning",
             "Build output (branch)", tail(read("build-branch.log"), 70))
    annotate("notice", "Build output (main)", tail(read("build-main.log"), 50))
else:
    annotate("notice", "Build", "Branch builds.")

if problems:
    print("Problems introduced by this branch: " + "; ".join(problems))
    raise SystemExit(1)
print("No problems introduced by this branch.")
