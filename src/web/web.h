#pragma once

#include <functional>

#include "filesystem_impl.h"

// Browser counterparts of what platform.h provides on desktop
namespace web {

// To be called before any user directory is looked up
void initStorage();

// To be called once the ImGui platform backend is initialized
void initInput();

// A browser cannot block on a file dialog, so both pickers return immediately.
// The board picker ends with an SDL_DROPFILE event, like drag and drop does.
void pickBoard();
void pickAttachment(std::function<void(const filesystem::path &)> onPicked);

} // namespace web
