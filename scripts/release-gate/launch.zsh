# Runs on the measuring Mac (scripts/release-gate/gate.ts sends it over ssh):
#   zsh -s -- <out file> <app> <stdin file or -> <app arguments...>
# Opens the app the way Finder does, passes on the probe's lines as they come, waits for it to quit,
# and samples it (by its own pid) the moment the probe says the main thread hangs, up to 5 times.
out=$1 app=$2 input=$3; shift 3
rm -f "$out" "$out".hang*(N)
if [[ $input == - ]]; then open -W -n --stdout "$out" --stderr "$out.err" "$app" --args "$@" &
else open -W -n --stdin "$input" --stdout "$out" --stderr "$out.err" "$app" --args "$@" &
fi
op=$!
seen=0 pid= hangs=0 sp=
while kill -0 $op 2>/dev/null; do
  sleep 0.1
  [[ -f $out ]] || continue
  lines=$(wc -l < "$out")
  (( lines > seen )) || continue
  new=$(sed -n "$((seen + 1)),${lines}p" "$out"); seen=$lines
  # The gate reads these as they come (it changes a note on the server when the probe asks).
  print -r -- "$new"
  if [[ -z $pid ]]; then
    pid=$(print -r -- "$new" | sed -n 's/^GATE started .* pid \([0-9]*\).*/\1/p' | head -1)
    # The app has read the account: its file goes.
    [[ -n $pid && $input != - ]] && rm -f "$input"
  fi
  # One sample at a time: a second one on the same process fails.
  if [[ -n $pid ]] && (( hangs < 5 )) && { [[ -z $sp ]] || ! kill -0 $sp 2>/dev/null; } && print -r -- "$new" | grep -q '^GATE hang'; then
    hangs=$((hangs + 1))
    sample "$pid" 1 -file "$out.hang$hangs" >/dev/null 2>&1 &
    sp=$!
  fi
done
[[ $input == - ]] || rm -f "$input"
wait
