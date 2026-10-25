#!/usr/bin/env bash
# 執行一個指令；失敗時把輸出轉成 GitHub 註解，方便不開日誌也能讀到錯誤。
# 註解長度有限，因此分成「開頭」與「結尾」兩則。
# 用法：run-step.sh <標籤> <指令...>
label="$1"; shift
log="$(mktemp)"
set +e
"$@" 2>&1 | tee "$log"
code=${PIPESTATUS[0]}
set -e
if [ "$code" -ne 0 ]; then
  clean="$(mktemp)"
  sed 's/\x1b\[[0-9;]*m//g' "$log" | cut -c1-300 > "$clean"
  emit() {
    local enc=${2//'%'/'%25'}
    enc=${enc//$'\r'/'%0D'}
    enc=${enc//$'\n'/'%0A'}
    echo "::error title=${1}::${enc}"
  }
  emit "${label} failed (exit ${code}) - first lines" "$(head -c 1800 "$clean")"
  if [ "$(wc -c < "$clean")" -gt 1800 ]; then
    emit "${label} - last lines" "$(tail -c 1800 "$clean")"
  fi
  exit "$code"
fi
