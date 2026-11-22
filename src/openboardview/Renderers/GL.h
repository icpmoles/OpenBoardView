#ifndef _RENDERERS_GL_H_
#define _RENDERERS_GL_H_

#if defined(__EMSCRIPTEN__)
// The browser is the loader, so there is no glad
#include <GLES3/gl3.h>
#define GLAD_MAKE_VERSION(major, minor) ((major) * 10000 + (minor))
#define GLAD_VERSION_MAJOR(version) ((version) / 10000)
#define GLAD_VERSION_MINOR(version) ((version) % 10000)
#elif defined(ENABLE_GLES2)
#include <glad/gles2.h>
#else
#include <glad/gl.h>
#endif

#endif
