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

DATA_DIR="$HOME/.local/share/com.coldwork.coldshot"
rm -rf "$DATA_DIR"

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

# The tray icon owns a 10x10 helper window that also answers to the app name,
# so pick the biggest match and insist it is the real 860x620 main window.
main_window() {
  local best="" best_area=0
  for id in $(xdotool search --name '^ColdShot$' 2>/dev/null); do
    local geo w h area
    geo=$(xdotool getwindowgeometry --shell "$id" 2>/dev/null) || continue
    w=$(sed -n 's/^WIDTH=//p' <<<"$geo")
    h=$(sed -n 's/^HEIGHT=//p' <<<"$geo")
    [ -z "$w" ] && continue
    area=$((w * h))
    if [ "$area" -gt "$best_area" ]; then
      best_area=$area
      best="$id $w $h"
    fi
  done
  echo "$best"
}

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

  local win="" w=0 h=0 ok=0
  for _ in $(seq 1 40); do
    read -r win w h <<<"$(main_window)"
    if [ -n "$win" ] && [ "$w" -ge 400 ] && [ "$h" -ge 300 ]; then
      ok=1
      break
    fi
    if ! kill -0 "$shell_pid" 2>/dev/null; then
      echo "process exited before a window appeared"
      break
    fi
    sleep 1
  done

  if [ "$ok" = 1 ]; then
    echo "main window mapped: id=$win ${w}x${h}"
    sleep 5
    if pgrep -x coldshot >/dev/null; then
      echo "still running 5s after the window appeared"
    else
      echo "process died after mapping its window"
      ok=0
    fi
  else
    echo "no window of at least 400x300 appeared"
  fi

  if [ "$ok" = 1 ]; then
    import -window root "$OUT/screen-$mode.png" 2>/dev/null
    # A window that maps but never paints leaves a flat black screen, which is
    # the usual shape of a webkit failure under software rendering.
    local dev
    dev=$(identify -format '%[fx:standard_deviation]' "$OUT/screen-$mode.png" 2>/dev/null)
    echo "screen pixel standard deviation: ${dev:-unknown}"
    if [ -n "$dev" ] && awk "BEGIN{exit !($dev < 0.01)}"; then
      echo "the window is blank, so the webview never painted"
      ok=0
    else
      echo "the webview painted actual content"
    fi
  fi

  if [ "$ok" = 1 ]; then
    if check_capture "$mode"; then
      CAPTURE_OK=1
    else
      CAPTURE_OK=0
    fi
  fi

  echo "--- stdout/stderr ---"
  cat "$log" 2>/dev/null
  echo "---------------------"

  pkill -x coldshot >/dev/null 2>&1
  kill "$shell_pid" >/dev/null 2>&1
  wait "$shell_pid" 2>/dev/null
  sleep 2

  [ "$ok" = 1 ]
}

# Startup only proves the shell works. Fire the full screen hotkey so the X11
# grab and the xcap capture path get exercised too.
check_capture() {
  local mode="$1"
  echo
  echo "--- full screen capture via Ctrl+Shift+3 ---"
  xdotool key --clearmodifiers ctrl+shift+3
  local shot=""
  for _ in $(seq 1 20); do
    shot=$(ls "$DATA_DIR/captures/"*.png 2>/dev/null | head -1)
    [ -n "$shot" ] && break
    sleep 1
  done
  if [ -z "$shot" ]; then
    echo "CAPTURE: no image was written to $DATA_DIR/captures"
    ls -la "$DATA_DIR" 2>/dev/null || echo "(no app data directory at all)"
    return 1
  fi
  echo "CAPTURE: wrote $shot"
  identify "$shot" || true
  cp "$shot" "$OUT/capture-$mode.png"
  if [ -f "$DATA_DIR/history.json" ]; then
    echo "history.json:"
    cat "$DATA_DIR/history.json"
  else
    echo "CAPTURE: the image landed but history.json was not written"
    return 1
  fi
}

CAPTURE_OK=0
MODE=""

if attempt default; then
  MODE=default
  echo
  echo "RESULT: launches on a stock headless Ubuntu 24.04 with no workarounds"
elif echo && echo "the default launch failed; retrying with the headless webkit workarounds" && attempt compat; then
  MODE=compat
  echo
  echo "RESULT: launches only with WEBKIT_DISABLE_DMABUF_RENDERER/COMPOSITING_MODE set"
  echo "this is the usual software rendering caveat for webkitgtk without a GPU"
else
  echo
  echo "RESULT: the app did not come up in either mode"
  exit 1
fi

if [ "$CAPTURE_OK" = 1 ]; then
  echo "RESULT: the full screen hotkey captured and stored an image"
  exit 0
fi

echo "RESULT: it starts and paints in $MODE mode, but the capture hotkey produced nothing"
exit 1
