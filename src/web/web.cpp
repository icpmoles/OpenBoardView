#include "platform.h" // Should be kept first

#include "web.h"

#include <cstdlib>
#include <utility>

#include <SDL.h>
#include <emscripten.h>

#include "imgui/imgui.h"

// Implemented in platform.js
// clang-format off
EM_JS(void, js_pick_board, (), { Module.obv.pickBoard(); });
EM_JS(void, js_pick_attachment, (), { Module.obv.pickAttachment(); });
EM_JS(void, js_copy, (const char *text), { Module.obv.copy(UTF8ToString(text)); });
EM_JS(int, js_is_mac, (), { return Module.obv.isMac ? 1 : 0; });
// clang-format on

static std::function<void(const filesystem::path &)> attachmentPicked;

// The main loop only renders for a little while after the last event
static void wake() {
	SDL_Event event{};
	event.type = SDL_USEREVENT;
	SDL_PushEvent(&event);
}

// Called from platform.js
extern "C" {

EMSCRIPTEN_KEEPALIVE void obv_web_open(const char *path) {
	SDL_Event event{};
	event.type      = SDL_DROPFILE;
	event.drop.file = SDL_strdup(path);
	SDL_PushEvent(&event);
}

EMSCRIPTEN_KEEPALIVE void obv_web_attach(const char *path) {
	if (!attachmentPicked) return;
	auto callback    = std::move(attachmentPicked);
	attachmentPicked = nullptr;
	callback(filesystem::u8path(path));
	wake();
}

EMSCRIPTEN_KEEPALIVE void obv_web_paste(const char *text) {
	if (!ImGui::GetCurrentContext()) return;
	ImGui::GetIO().AddInputCharactersUTF8(text);
	wake();
}

EMSCRIPTEN_KEEPALIVE void obv_web_wake() {
	wake();
}
}

namespace web {

void initStorage() {
	// Directory mounted on IndexedDB by platform.js, get_user_dir() follows these
	setenv("XDG_CONFIG_HOME", "/openboardview/config", 1);
	setenv("XDG_DATA_HOME", "/openboardview/data", 1);
}

void initInput() {
	ImGui::GetIO().ConfigMacOSXBehaviors = js_is_mac(); // Cmd instead of Ctrl, as in the macOS build

	// SDL's clipboard is private to the page
	ImGui::GetPlatformIO().Platform_SetClipboardTextFn = [](ImGuiContext *, const char *text) {
		SDL_SetClipboardText(text);
		js_copy(text);
	};
}

void pickBoard() {
	js_pick_board();
}

void pickAttachment(std::function<void(const filesystem::path &)> onPicked) {
	attachmentPicked = std::move(onPicked);
	js_pick_attachment();
}

} // namespace web

// No system fonts in a browser, use the ones embedded at link time
const std::string get_font_path(const std::string &name) {
	if (name.empty() || name == "Roboto") return "/fonts/Roboto-Medium.ttf";
	if (name == "Droid Sans") return "/fonts/DroidSans.ttf";
	return {};
}
