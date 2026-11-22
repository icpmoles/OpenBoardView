#!/bin/sh
# Build OpenBoardView for browsers. The result is a static site in build_web/dist.
#   ./build_web.sh [--recompile] [extra CMake arguments]
set -eu

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD="${BUILD_DIR:-$ROOT/build_web}"

if ! command -v emcmake >/dev/null 2>&1; then
	echo "Emscripten not found. On Ubuntu 24.04: sudo apt install emscripten" >&2
	exit 1
fi

if [ "${1:-}" = "--recompile" ]; then
	shift
	rm -rf "$BUILD/cmake"
fi
mkdir -p "$BUILD"
BUILD="$(cd "$BUILD" && pwd)"

# A CMake cache can't be reused with another compiler
TOOLCHAIN="$(command -v emcc) $(emcc -dumpversion)"
if [ "$(cat "$BUILD/toolchain" 2>/dev/null)" != "$TOOLCHAIN" ]; then
	rm -rf "$BUILD/cmake"
	echo "$TOOLCHAIN" > "$BUILD/toolchain"
fi

# Debian and Ubuntu ship Emscripten with a frozen cache, so it can build neither SDL2 nor zlib.
# Give it a private cache made of symlinks to the system one (which is 700+ MiB).
if [ -z "${EM_CACHE:-}" ] && [ "$(em-config FROZEN_CACHE)" = "True" ]; then
	SYSTEM_CACHE="$(em-config CACHE)"
	CACHE="$BUILD/emscripten-cache-$(emcc -dumpversion)"
	if [ ! -d "$CACHE" ]; then
		rm -rf "$CACHE.tmp"
		cp -as "$SYSTEM_CACHE" "$CACHE.tmp"
		# Those get written to, so they can't be links to the system's files
		rm -f "$CACHE.tmp/cache.lock" "$CACHE.tmp/sanity.txt"
		mv "$CACHE.tmp" "$CACHE"
	fi
	export EM_CACHE="$CACHE"
	export EM_FROZEN_CACHE= # has to be empty, any other string counts as true
fi

JOBS="${THREADS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)}"

# Build the ports first, otherwise the parallel compile jobs race to download them
embuilder build sdl2 zlib

emcmake cmake -S "$ROOT" -B "$BUILD/cmake" -DCMAKE_BUILD_TYPE=Release "$@"
cmake --build "$BUILD/cmake" --parallel "$JOBS"

# Emscripten links an empty program without complaining if it doesn't find main()
if ! grep -q "Unrecognized file format" "$BUILD/cmake/dist/openboardview.wasm"; then
	echo "The application is missing from the WebAssembly binary, main() was not exported." >&2
	exit 1
fi

rm -rf "$BUILD/dist"
cp -R "$BUILD/cmake/dist" "$BUILD/dist"

echo
echo "Built $BUILD/dist"
echo "Try it with: python3 -m http.server -b 127.0.0.1 -d '$BUILD/dist' 8080"
