#!/usr/bin/env bash
# Build the Agentic TV APK without Gradle: aapt2 + javac + d8 + apksigner.  Output: build/home.apk
set -euo pipefail
cd "$(dirname "$0")"
SDK=${ANDROID_HOME:-$HOME/Android/Sdk}; BT=$SDK/build-tools/35.0.0; # Prefer installed Android SDK 36.
JAR=$SDK/platforms/android-36/android.jar
if [ ! -f "$JAR" ]; then
    echo "ERROR: Android SDK platform 36 not found: $JAR" >&2
    exit 1
fi
rm -rf build && mkdir -p build/classes
$BT/aapt2 compile --dir res -o build/res.zip
$BT/aapt2 link -o build/base.apk -I $JAR --manifest AndroidManifest.xml -A assets -R build/res.zip --java build/gen --auto-add-overlay --min-sdk-version 24 --target-sdk-version 34
javac -source 11 -target 11 -classpath $JAR -d build/classes $(find src build/gen -name '*.java')
$BT/d8 --min-api 24 --lib $JAR --output build $(find build/classes -name '*.class')
(cd build && zip -qj base.apk classes.dex)
$BT/zipalign -f -p 4 build/base.apk build/aligned.apk
# release key (kept outside the repo) so GitHub updates install over each other; debug key as a fallback for contributors
K=~/.config/agentic-tv
if [ -f $K/release.jks ]; then . $K/keystore.properties; SIGN=(--ks $K/release.jks --ks-pass pass:$STOREPASS --ks-key-alias agentictv)
else SIGN=(--ks ~/.android/debug.keystore --ks-pass pass:android --ks-key-alias androiddebugkey); fi
$BT/apksigner sign "${SIGN[@]}" --out build/home.apk build/aligned.apk
ls -la build/home.apk
