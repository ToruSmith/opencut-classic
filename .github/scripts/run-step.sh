#!/usr/bin/env bash
# 執行一個指令；失敗時把輸出尾段轉成 GitHub 註解，方便不開日誌也能讀到錯誤。
# 用法：run-step.sh <標籤> <指令...>
label="$1"; shift
log="$(mktemp)"
set +e
"$@" 2>&1 | tee "$log"
code=${PIPESTATUS[0]}
set -e
if [ "$code" -ne 0 ]; then
  body="$(tail -n 70 "$log" | sed 's/\x1b\[[0-9;]*m//g' | cut -c1-400)"
  enc=${body//'%'/'%25'}
  enc=${enc//$'\r'/'%0D'}
  enc=${enc//$'\n'/'%0A'}
  echo "::error title=${label} failed (exit ${code})::${enc}"
  exit "$code"
fi
