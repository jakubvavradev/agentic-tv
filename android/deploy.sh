#!/usr/bin/env bash
# Build, install, make it the Home app and verify it is in front (reinstalling clears the default-home choice).
set -euo pipefail
cd "$(dirname "$0")"; T=${TV:-10.3.0.42:5555}; A="adb -s $T"
./build.sh >/dev/null
$A install -r build/home.apk >/dev/null
$A shell cmd package set-home-activity cz.vavra.home/.MainActivity >/dev/null
$A shell input keyevent KEYCODE_HOME; sleep 4
top=$($A shell dumpsys activity activities | grep -m1 topResumedActivity)
grep -q cz.vavra.home <<<"$top" && echo "OK: home screen in front" || { echo "NOT in front: $top"; exit 1; }
