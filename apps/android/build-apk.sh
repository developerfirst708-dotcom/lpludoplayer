#!/usr/bin/env bash
# Build the LPLUDO WebView wrapper into a signed, installable APK using the
# Android command-line tools (no Gradle required).
#
# Prereqs:  $ANDROID_HOME (or ~/Android/Sdk) with a platform + build-tools,
#           JDK 17, and the site already deployed (see SITE_URL in MainActivity).
#
# Output:   apps/android/dist/LPLUDO.apk
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
SDK_ROOT="$ANDROID_HOME"
PLATFORM="$SDK_ROOT/platforms/android-36"
BT="$(ls -d "$SDK_ROOT"/build-tools/* | sort -V | tail -1)"
OUT="$ROOT/dist"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> SDK: $SDK_ROOT | platform: $PLATFORM | build-tools: $BT"

mkdir -p "$OUT"

echo "==> Compiling resources"
"$BT/aapt2" compile --dir "$ROOT/res" -o "$WORK/res.zip"

echo "==> Linking base APK"
"$BT/aapt2" link -o "$WORK/base.apk" \
  -I "$PLATFORM/android.jar" \
  --manifest "$ROOT/AndroidManifest.xml" \
  "$WORK/res.zip"

echo "==> Compiling Java -> dex"
mkdir -p "$WORK/java-out"
javac -source 8 -target 8 -classpath "$PLATFORM/android.jar" -d "$WORK/java-out" \
  "$ROOT"/java/com/lpludo/app/*.java
mkdir -p "$WORK/dex-out"
"$BT/d8" --release --lib "$PLATFORM/android.jar" --min-api 23 \
  --output "$WORK/dex-out" "$WORK"/java-out/com/lpludo/app/*.class

echo "==> Packaging classes.dex"
(cd "$WORK/dex-out" && zip -uq "$WORK/base.apk" classes.dex)

echo "==> Aligning"
"$BT/zipalign" -f 4 "$WORK/base.apk" "$WORK/aligned.apk"

echo "==> Signing"
KS="$ROOT/dist/lpludo.keystore"
if [ ! -f "$KS" ]; then
  echo "    (generating a release keystore — keep this file safe)"
  keytool -genkey -v -keystore "$KS" -alias lpludo -keyalg RSA -keysize 2048 \
    -validity 10000 -storepass lpludo123 -keypass lpludo123 \
    -dname "CN=LPLUDO, OU=LPLUDO, O=LPLUDO, L=Mumbai, ST=MH, C=IN"
fi
"$BT/apksigner" sign --ks "$KS" --ks-key-alias lpludo \
  --ks-pass pass:lpludo123 --key-pass pass:lpludo123 \
  --out "$OUT/LPLUDO.apk" "$WORK/aligned.apk"

echo "==> Done -> $OUT/LPLUDO.apk"
"$BT/apksigner" verify "$OUT/LPLUDO.apk" && echo "    signature OK"
ls -lh "$OUT/LPLUDO.apk"