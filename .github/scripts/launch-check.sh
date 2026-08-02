#!/usr/bin/env bash
set -uo pipefail

OUT=/tmp/coldshot-smoke
mkdir -p "$OUT"
rm -f "$OUT"/*.log "$OUT"/*.png

export XDG_RUNTIME_DIR="$OUT/xdg"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
export HOME="${HOME:-/root}"
export DISPLAY=:99
export GDK_BACKEND=x11
export NO_AT_BRIDGE=1

Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >"$OUT/xvfb.log" 2>&1 &
XVFB_PID=$!
for _ in $(seq 1 30); do
  xdpyinfo -display :99 >/dev/null 2>&1 && break
  sleep 1
done
if ! xdpyinfo -display :99 >/dev/null 2>&1; then
  echo "could not start Xvfb"
  cat "$OUT/xvfb.log"
  exit 1
fi
echo "Xvfb up on :99 (1280x800)"

cleanup() {
  pkill -x coldshot >/dev/null 2>&1
  kill "$XVFB_PID" >/dev/null 2>&1
  wait "$XVFB_PID" 2>/dev/null
}
trap cleanup EXIT

attempt() {
  local mode="$1"
  local log="$OUT/launch-$mode.log"
  echo
  echo "=== launch attempt: $mode ==="

  if [ "$mode" = compat ]; then
    export WEBKIT_DISABLE_COMPOSITING_MODE=1
    export WEBKIT_DISABLE_DMABUF_RENDERER=1
    export LIBGL_ALWAYS_SOFTWARE=1
  else
    unset WEBKIT_DISABLE_COMPOSITING_MODE WEBKIT_DISABLE_DMABUF_RENDERER LIBGL_ALWAYS_SOFTWARE
  fi

  dbus-run-session -- /usr/bin/coldshot >"$log" 2>&1 &
  local shell_pid=$!

  local win=""
  for _ in $(seq 1 40); do
    win=$(xdotool search --name '^ColdShot$' 2>/dev/null | head -1)
    [ -n "$win" ] && break
    if ! kill -0 "$shell_pid" 2>/dev/null; then
      echo "process exited before a window appeared"
      break
    fi
    sleep 1
  done

  if [ -n "$win" ]; then
    echo "window mapped: id=$win"
    xdotool getwindowgeometry "$win" || true
    xdotool getwindowname "$win" || true
    sleep 5
    if pgrep -x coldshot >/dev/null; then
      echo "still running 5s after the window appeared"
    else
      echo "process died after mapping its window"
      win=""
    fi
    import -window root "$OUT/screen-$mode.png" 2>/dev/null || true
  fi

  echo "--- stdout/stderr ---"
  cat "$log" 2>/dev/null
  echo "---------------------"

  pkill -x coldshot >/dev/null 2>&1
  kill "$shell_pid" >/dev/null 2>&1
  wait "$shell_pid" 2>/dev/null
  sleep 2

  [ -n "$win" ]
}

if attempt default; then
  echo
  echo "RESULT: launches on a stock headless Ubuntu 24.04 with no workarounds"
  exit 0
fi

echo
echo "the default launch did not map a window; retrying with the headless webkit workarounds"
if attempt compat; then
  echo
  echo "RESULT: launches only with WEBKIT_DISABLE_DMABUF_RENDERER/COMPOSITING_MODE set"
  echo "this is the usual software-rendering caveat for webkitgtk without a GPU"
  exit 0
fi

echo
echo "RESULT: no window appeared in either mode"
exit 1
