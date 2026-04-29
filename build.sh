#!/usr/bin/env bash
set -euo pipefail

# Vietboard production build script
# Replaces build.bat with a cross-platform, ES6-compatible toolchain

echo "=== Vietboard Build ==="

# ---------------------------------------------------------------------------
# 1. Clean build directory
# ---------------------------------------------------------------------------
echo "[1/7] Cleaning play/..."
rm -rf play
mkdir -p play/js play/css play/lang play/pics play/sounds

# ---------------------------------------------------------------------------
# 2. Timestamp for cache busting (HHMMSS, zero-padded)
# ---------------------------------------------------------------------------
TIMESTAMP=$(date +%H%M%S)
echo "[2/7] Build timestamp: $TIMESTAMP"

# ---------------------------------------------------------------------------
# 3. Minify CSS
# ---------------------------------------------------------------------------
echo "[3/7] Minifying CSS..."
node scripts/minify.js css css/style.css -o play/css/styles.min.css

# ---------------------------------------------------------------------------
# 4. Bundle + minify language files (includes emojis)
# ---------------------------------------------------------------------------
echo "[4/7] Bundling language files..."
node scripts/minify.js js \
  lang/vi_wordlist.js \
  lang/vi_defs.js \
  lang/vi_letters.js \
  lang/emojis.js \
  -o play/js/lang.min.js

# ---------------------------------------------------------------------------
# 5. Bundle + minify application source files
# ---------------------------------------------------------------------------
echo "[5/7] Bundling application files..."
node scripts/minify.js js \
  src/multiplayer.js \
  src/redipsdrag.js \
  src/bonuses.js \
  src/ui.js \
  src/engine.js \
  src/events.js \
  src/changelog.js \
  -o play/js/app.min.js

# ---------------------------------------------------------------------------
# 6. Copy static assets
# ---------------------------------------------------------------------------
echo "[6/7] Copying static assets..."
cp index.html play/
cp -a pics/* play/pics/
cp -a sounds/* play/sounds/

# Translation files are loaded dynamically; keep them separate
cp lang/en_translate.js play/lang/
cp lang/vi_translate.js play/lang/

# ---------------------------------------------------------------------------
# 7. Transform play/index.html for production
# ---------------------------------------------------------------------------
echo "[7/7] Transforming index.html for production..."

# Cache-bust CSS
sed -i "s|css/style.css|css/styles.min.css?v=$TIMESTAMP|" play/index.html

# Replace one lang script tag with the bundled version, delete the rest
sed -i "s|<script src=\"lang/vi_wordlist.js\"></script>|<script src=\"js/lang.min.js?v=$TIMESTAMP\"></script>|" play/index.html
sed -i '/<script src="lang\/emojis.js"><\/script>/d' play/index.html
sed -i '/<script src="lang\/vi_defs.js"><\/script>/d' play/index.html
sed -i '/<script src="lang\/vi_letters.js"><\/script>/d' play/index.html

# Replace one src script tag with the bundled version, delete the rest
sed -i "s|<script src=\"src/redipsdrag.js\"></script>|<script src=\"js/app.min.js?v=$TIMESTAMP\"></script>|" play/index.html
sed -i '/<script src="src\/bonuses.js"><\/script>/d' play/index.html
sed -i '/<script src="src\/changelog.js"><\/script>/d' play/index.html
sed -i '/<script src="src\/engine.js"><\/script>/d' play/index.html
sed -i '/<script src="src\/events.js"><\/script>/d' play/index.html
sed -i '/<script src="src\/multiplayer.js"><\/script>/d' play/index.html
sed -i '/<script src="src\/ui.js"><\/script>/d' play/index.html

echo "=== Build complete ==="
echo "Output: play/"
