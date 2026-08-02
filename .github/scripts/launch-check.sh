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
    walk_tabs "$mode"
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

# The window is 860x620 centred on a 1280x800 root, so the header tabs sit at
# fixed coordinates. Click each one and keep the frame for inspection.
walk_tabs() {
  local mode="$1"
  echo
  echo "--- header tabs ---"
  local tabs="History:801 Settings:903 Update:1006"
  for entry in $tabs; do
    local name="${entry%%:*}"
    local x="${entry##*:}"
    xdotool mousemove "$x" 118 click 1
    # Update fires a network call, so give it room to come back.
    if [ "$name" = Update ]; then sleep 8; else sleep 2; fi
    import -window root "$OUT/tab-${name}-$mode.png" 2>/dev/null
    echo "$name tab captured to tab-${name}-$mode.png"
  done
  xdotool mousemove 698 118 click 1
  sleep 2
}

# The app hides its own window before grabbing, so on an empty Xvfb a working
# capture and a broken one both come out black. Put a recognisable scene on the
# root and every grab can be compared against it pixel for pixel.
build_scene() {
  convert -size 1280x800 gradient:'#12386b'-'#0a0f18' \
    -fill '#2fd0a8' -draw 'rectangle 80,120 420,360' \
    -fill '#d0532f' -draw 'circle 900,260 900,380' \
    -fill '#e8c33a' -draw 'polygon 520,640 640,440 760,640' \
    -fill white -pointsize 46 -annotate +80+470 'ColdShot on Ubuntu 24.04' \
    -fill '#9fb6d9' -pointsize 26 -annotate +80+520 "$(date -u '+%Y-%m-%d %H:%M:%S UTC')" \
    "$OUT/scene.png" 2>/dev/null
  feh --bg-scale "$OUT/scene.png" 2>/dev/null ||
    display -window root "$OUT/scene.png" 2>/dev/null ||
    xsetroot -solid '#2f6fd0'
  sleep 2

  # A silent fallback here would leave every later comparison passing against
  # nothing, so confirm the scene really is on screen before trusting it.
  import -window root "$OUT/scene-onscreen.png" 2>/dev/null
  local drift
  drift=$(rmse_against "$OUT/scene.png" "$OUT/scene-onscreen.png")
  echo "scene painted on the root, difference from the source = ${drift:-unmeasurable}"
  if [ -z "$drift" ] || awk "BEGIN{exit !($drift > 0.05)}"; then
    echo "the reference scene is not actually on screen, so captures cannot be verified"
    return 1
  fi
}

# Each capture also writes a _thumb.png alongside it, and the thumbnail lands
# last, so it wins a plain sort by mtime. Skip it.
newest_since() {
  find "$DATA_DIR/captures" -name '*.png' ! -name '*_thumb.png' -newer "$1" \
    -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-
}

wait_for_capture() {
  local marker="$1" found=""
  for _ in $(seq 1 25); do
    found=$(newest_since "$marker")
    if [ -n "$found" ]; then
      # Let the writer finish before anything reads the file.
      sleep 1
      echo "$found"
      return 0
    fi
    sleep 1
  done
  return 1
}

rmse_against() {
  compare -metric RMSE "$1" "$2" null: 2>&1 | sed 's/.*(\(.*\)).*/\1/'
}

capture_full() {
  local mode="$1"
  echo
  echo "--- full screen capture via Ctrl+Shift+3 ---"
  local marker="$OUT/.marker-full"
  touch "$marker"
  sleep 1
  xdotool key --clearmodifiers ctrl+shift+3
  local shot
  shot=$(wait_for_capture "$marker") || {
    echo "FULL: no image was written to $DATA_DIR/captures"
    ls -la "$DATA_DIR" 2>/dev/null || echo "(no app data directory at all)"
    return 1
  }
  cp "$shot" "$OUT/capture-full-$mode.png"
  echo "FULL: wrote $shot"
  identify "$shot"
  sleep 2
  import -window root "$OUT/after-capture-$mode.png" 2>/dev/null

  local rmse
  rmse=$(rmse_against "$OUT/scene.png" "$shot")
  echo "FULL: difference from what was on screen = ${rmse:-unmeasurable}"
  if [ -z "$rmse" ] || awk "BEGIN{exit !($rmse > 0.05)}"; then
    echo "FULL: the captured image is not what the screen was showing"
    return 1
  fi
  echo "FULL: the grab reproduces the screen"
}

# Area capture goes through the overlay, so drive it with a real drag. The rect
# starts at x=300 to clear the preview card the full screen grab just parked in
# the bottom left corner.
capture_area() {
  local mode="$1"
  echo
  echo "--- area capture via Ctrl+Shift+1, dragging 300,200 to 900,600 ---"
  local marker="$OUT/.marker-area"
  touch "$marker"
  sleep 1
  xdotool key --clearmodifiers ctrl+shift+1
  sleep 4
  import -window root "$OUT/overlay-$mode.png" 2>/dev/null
  xdotool mousemove 300 200
  sleep 1
  xdotool mousedown 1
  sleep 1
  xdotool mousemove 600 400
  sleep 1
  xdotool mousemove 900 600
  sleep 1
  xdotool mouseup 1

  local shot
  shot=$(wait_for_capture "$marker") || {
    echo "AREA: the drag produced no image"
    return 1
  }
  cp "$shot" "$OUT/capture-area-$mode.png"
  local dim
  dim=$(identify -format '%wx%h' "$shot")
  echo "AREA: wrote $shot ($dim), expected 600x400"
  if [ "$dim" != "600x400" ]; then
    echo "AREA: the crop is not the region that was dragged"
    return 1
  fi

  convert "$OUT/scene.png" -crop 600x400+300+200 +repage "$OUT/scene-crop.png"
  local rmse
  rmse=$(rmse_against "$OUT/scene-crop.png" "$shot")
  echo "AREA: difference from that region of the screen = ${rmse:-unmeasurable}"
  if [ -z "$rmse" ] || awk "BEGIN{exit !($rmse > 0.05)}"; then
    echo "AREA: the crop does not match the region that was dragged"
    return 1
  fi
  echo "AREA: the dragged region matches the screen"
}

check_capture() {
  local mode="$1"
  build_scene
  capture_full "$mode" || return 1
  capture_area "$mode" || return 1
  if [ -f "$DATA_DIR/history.json" ]; then
    echo
    echo "history.json:"
    cat "$DATA_DIR/history.json"
    echo
  else
    echo "CAPTURE: images landed but history.json was not written"
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
  echo "RESULT: both full screen and dragged area captures reproduce the screen"
  exit 0
fi

echo "RESULT: it starts and paints in $MODE mode, but capturing does not work"
exit 1
