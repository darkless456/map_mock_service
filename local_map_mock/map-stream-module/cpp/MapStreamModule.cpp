/**
 * @file MapStreamModule.cpp
 * @brief Compilation unit — pulls in stb_image implementation.
 */

#define STB_IMAGE_IMPLEMENTATION
#define STBI_NO_STDIO          // we only decode from memory
#define STBI_ONLY_PNG          // only PNG support needed, reduces binary size

#include "mapstream/stb_image.h"
#include "MapStreamModule.h"
