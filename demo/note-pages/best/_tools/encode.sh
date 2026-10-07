#!/bin/zsh
# encode.sh <rec dir> <out dir> <app> <test> : trims to the test's marks, cuts waits and the teardown, H.264 under 3 MB, poster.
set -e
REC=$1; OUT=$2; APP=$3; T=$4; AP=${5:-light}
src="$REC/$T-$AP.mp4"; r0=$(cat "$REC/$T-$AP-rec-start.txt")
ms=$(cat "$REC/$T-$AP-mark-start.txt"); me=$(cat "$REC/$T-$AP-mark-end.txt")
vdur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src")
lag=$(python3 -c "print(max(0, $(cat $REC/$T-$AP-rec-stop.txt) - $r0 - $vdur))")
ss=$(python3 -c "print(max(0, $ms - $r0 - $lag - 0.3))"); to=$(python3 -c "print($me - $r0 - $lag + 0.4)")
mkdir -p "$OUT/$APP"; dst="$OUT/$APP/$APP.mp4"; tmp="$REC/$APP-trim.mp4"; sq="$REC/$APP-sq.mp4"
nice -n 10 ffmpeg -loglevel error -y -ss $ss -to $to -i "$src" -vf fps=30 -c:v libx264 -crf 14 -preset fast -an "$tmp"
python3 "$(dirname "$0")/squeeze.py" "$tmp" "$sq" ${HOLD:-0.9} ${SPEED:-1}
for crf in 25 28 31 34; do
  nice -n 10 ffmpeg -loglevel error -y -i "$sq" -vf "scale=600:-2:flags=lanczos,format=yuv420p" -c:v libx264 -preset slow -crf $crf -profile:v high -movflags +faststart -an "$dst"
  size=$(stat -f %z "$dst"); (( size < 2900000 )) && break
done
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$dst")
nice -n 10 ffmpeg -loglevel error -y -ss $(python3 -c "print($dur * ${POSTER_AT:-0.35})") -i "$dst" -frames:v 1 -q:v 3 "$OUT/$APP/$APP-poster.jpg"
echo "$APP: $(python3 -c "print(round($dur,1))") s, $((size / 1024)) KB"
