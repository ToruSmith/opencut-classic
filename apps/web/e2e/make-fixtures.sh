#!/usr/bin/env bash
# 產生自動驗收用的合成素材:4 支不同純色的 VP9 影片(6 秒、30fps、每 15 格一個關鍵影格)
# 與 60 張不同顏色的 PNG。純色讓驗收腳本能用「畫面中心的顏色」判斷現在顯示的是哪個素材。
# 需要 ffmpeg(含 libvpx-vp9)。用法:make-fixtures.sh <輸出資料夾>
set -euo pipefail
out="${1:?用法: make-fixtures.sh <輸出資料夾>}"
mkdir -p "$out"

index=0
for color in red green blue yellow; do
	ffmpeg -y -loglevel error \
		-f lavfi -i "color=c=${color}:s=640x360:r=30:d=6" \
		-c:v libvpx-vp9 -deadline realtime -cpu-used 8 -g 15 -b:v 300k -pix_fmt yuv420p \
		"$out/clip-${index}-${color}.webm"
	index=$((index + 1))
done

for n in $(seq 0 59); do
	r=$(((n * 37) % 256))
	g=$(((n * 91 + 40) % 256))
	b=$(((n * 53 + 130) % 256))
	hex=$(printf '%02x%02x%02x' "$r" "$g" "$b")
	ffmpeg -y -loglevel error \
		-f lavfi -i "color=c=0x${hex}:s=1280x720" -frames:v 1 \
		"$out/img-$(printf '%02d' "$n").png"
done

# 20 支不同顏色的小影片(2 秒),用來把解碼器逼到上限(MAX_ACTIVE_SINKS)驗證淘汰
for n in $(seq 0 19); do
	r=$(((n * 53 + 20) % 256))
	g=$(((n * 97 + 60) % 256))
	b=$(((n * 29 + 100) % 256))
	hex=$(printf '%02x%02x%02x' "$r" "$g" "$b")
	ffmpeg -y -loglevel error \
		-f lavfi -i "color=c=0x${hex}:s=320x180:r=30:d=2" \
		-c:v libvpx-vp9 -deadline realtime -cpu-used 8 -g 15 -b:v 100k -pix_fmt yuv420p \
		"$out/many-$(printf '%02d' "$n").webm"
done

ls "$out" | wc -l | xargs echo "fixtures:"
