# Dependencies of the WebAssembly build, included by src/CMakeLists.txt instead of the desktop ones.
# Supports Emscripten 3.1.6 (Ubuntu 24.04 package) and newer.
# Unlike the desktop configuration, nothing here writes to the source tree.

foreach(header imgui/imgui.h stb/stb_image.h utf8/utf8.h mpc/mpc.h)
	if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/${header}")
		message(FATAL_ERROR "src/${header} is missing, run: git submodule update --init --recursive")
	endif()
endforeach()

set(CMAKE_CXX_STANDARD 17)
set(FILESYSTEM_LIBRARIES)
add_definitions(-DWITH_STD_FILESYSTEM -DENABLE_SDL2 -DSTBI_FAILURE_USERMSG)

# Every object has to agree on the exception model. Parsers rely on exceptions.
add_compile_options(-fwasm-exceptions -sUSE_SDL=2 -sUSE_ZLIB=1)

set(UTF8_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/utf8")
include_directories("${CMAKE_CURRENT_SOURCE_DIR}/stb")

add_subdirectory(sqlite3)
target_compile_definitions(SQLite3 PRIVATE SQLITE_THREADSAFE=0 SQLITE_OMIT_LOAD_EXTENSION)
target_compile_options(SQLite3 PRIVATE -w)

add_library(mpc STATIC mpc/mpc.c)

# The desktop build rewrites the includes of this file in place to use glad.
# Use a copy with the GLES 3 header, which works from a pristine or a rewritten submodule.
set(backend "${CMAKE_CURRENT_SOURCE_DIR}/imgui/backends/imgui_impl_opengl3.cpp")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${backend}")
file(READ "${backend}" input)
string(REPLACE "glad/gles.h" "GLES3/gl3.h" input "${input}")
set(web_backend "${CMAKE_CURRENT_BINARY_DIR}/imgui_impl_opengl3_web.cpp")
file(WRITE "${web_backend}" "${input}")

add_library(imgui STATIC
	imgui/imgui.cpp
	imgui/imgui_draw.cpp
	imgui/imgui_tables.cpp
	imgui/imgui_widgets.cpp
	imgui/misc/cpp/imgui_stdlib.cpp
	imgui/backends/imgui_impl_sdl2.cpp
	"${web_backend}")
target_compile_definitions(imgui PUBLIC "-DImDrawIdx=unsigned int" IMGUI_IMPL_OPENGL_ES3) # ES 3 is WebGL 2
target_include_directories(imgui
	PUBLIC
		"${CMAKE_CURRENT_SOURCE_DIR}/imgui"
		"${CMAKE_CURRENT_SOURCE_DIR}/imgui/misc/cpp"
	PRIVATE
		"${CMAKE_CURRENT_SOURCE_DIR}/imgui/backends")
# <emscripten/em_js.h>, which that backend includes, is not self-contained in Emscripten 3.1.6
set_source_files_properties(imgui/backends/imgui_impl_sdl2.cpp PROPERTIES COMPILE_OPTIONS "-include;emscripten.h")
