#!/usr/bin/env bash
# 單元測試「棘輪」:
#  - 沒有基準檔:只回報目前失敗的測試清單(寫成 annotation),不擋 CI。
#  - 有基準檔(.github/known-failing-tests.txt):出現基準以外的新失敗 -> CI 失敗;
#    基準裡的測試已經修好 -> 只提醒,請把它從清單移除。
# 在 apps/web 目錄執行。
set -uo pipefail

baseline="../../.github/known-failing-tests.txt"
log="$(mktemp)"
bun test src 2>&1 | tee "$log"
bun_exit=${PIPESTATUS[0]}

failing="$(mktemp)"
sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -E '^\(fail\)' | sed -E 's/ \[[0-9.]+ms\]$//' | LC_ALL=C sort -u > "$failing"
count=$(wc -l < "$failing")

enc() { local s=${1//'%'/'%25'}; s=${s//$'\r'/'%0D'}; echo "${s//$'\n'/'%0A'}"; }

# 診斷:預載檔(test-setup.ts)有沒有成功,以及失敗測試的錯誤訊息(去重後最多 12 種)
clean="$(mktemp)"
sed 's/\x1b\[[0-9;]*m//g' "$log" > "$clean"
setup_msgs="$(grep -A6 '\[test-setup\]' "$clean" | head -c 3000)"
[ -n "$setup_msgs" ] && echo "::warning title=test-setup 警告::$(enc "$setup_msgs")"
err_msgs="$(grep -E '^(error|[A-Za-z]*Error):|^\s+(error|TypeError|ReferenceError)' "$clean" | sed -E 's/^\s+//' | LC_ALL=C sort | uniq -c | sort -rn | head -12 | head -c 3000)"
[ -n "$err_msgs" ] && echo "::notice title=test-errors::$(enc "$err_msgs")"

if [ ! -f "$baseline" ]; then
  echo "::notice title=failing-tests (${count})::$(enc "$(head -c 50000 "$failing")")"
  exit 0
fi

known="$(mktemp)"
grep -v '^\s*#' "$baseline" | grep -v '^\s*$' | LC_ALL=C sort -u > "$known"
new="$(LC_ALL=C comm -13 "$known" "$failing")"
fixed="$(LC_ALL=C comm -23 "$known" "$failing")"

if [ -n "$fixed" ]; then
  echo "::warning title=已修好的舊失敗,請從 known-failing-tests.txt 移除::$(enc "$fixed")"
fi
if [ -n "$new" ]; then
  echo "::error title=新的測試失敗(不在已知清單內)::$(enc "$new")"
  exit 1
fi
# bun 本身失敗但沒有任何 (fail) 行 = 測試檔載入失敗等,也不能放過
if [ "$bun_exit" -ne 0 ] && [ "$count" -eq 0 ]; then
  echo "::error title=bun test 失敗但沒有 (fail) 行::請看日誌"
  exit 1
fi
echo "已知失敗 ${count} 個,沒有新的失敗。"
