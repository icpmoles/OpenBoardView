# Link settings of the WebAssembly build, included by src/openboardview/CMakeLists.txt

set(WEB_DIR "${PROJECT_SOURCE_DIR}/src/web")
set(FONT_DIR "${PROJECT_SOURCE_DIR}/src/imgui/misc/fonts")
set(DIST_DIR "${PROJECT_BINARY_DIR}/dist")

target_include_directories(${PROJECT_NAME_LOWER} PRIVATE "${WEB_DIR}")

if(EMSCRIPTEN_VERSION VERSION_LESS "3.1.27")
	set(STACK_SETTING TOTAL_STACK) # former name of STACK_SIZE
else()
	set(STACK_SETTING STACK_SIZE)
endif()

# Stack: the default is tiny, while mpc is recursive and a few functions have big locals. 8 MiB is as on Linux.
target_link_options(${PROJECT_NAME_LOWER} PRIVATE
	-fwasm-exceptions
	-sUSE_SDL=2
	-sUSE_ZLIB=1
	-sMIN_WEBGL_VERSION=2
	-sMAX_WEBGL_VERSION=2
	-sALLOW_MEMORY_GROWTH=1
	-sINITIAL_MEMORY=33554432
	-s${STACK_SETTING}=8388608
	-sFORCE_FILESYSTEM=1
	-sENVIRONMENT=web
	-sEXPORTED_RUNTIME_METHODS=ccall,FS,UTF8ToString,addRunDependency,removeRunDependency
	-lidbfs.js
	"SHELL:--pre-js \"${WEB_DIR}/platform.js\""
	"SHELL:--embed-file \"${FONT_DIR}/Roboto-Medium.ttf@/fonts/Roboto-Medium.ttf\""
	"SHELL:--embed-file \"${FONT_DIR}/DroidSans.ttf@/fonts/DroidSans.ttf\""
)
set_target_properties(${PROJECT_NAME_LOWER} PROPERTIES
	RUNTIME_OUTPUT_DIRECTORY "${DIST_DIR}"
	LINK_DEPENDS "${WEB_DIR}/platform.js")

configure_file("${WEB_DIR}/index.html" "${DIST_DIR}/index.html" COPYONLY)
configure_file("${PROJECT_SOURCE_DIR}/asset/icon.svg" "${DIST_DIR}/icon.svg" COPYONLY)
configure_file("${PROJECT_SOURCE_DIR}/LICENSE" "${DIST_DIR}/LICENSE.txt" COPYONLY)
