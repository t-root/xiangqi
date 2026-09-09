/*
  Stockfish, a UCI chess playing engine derived from Glaurung 2.1
  Copyright (C) 2004-2026 The Stockfish developers (see AUTHORS file)

  Stockfish is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  Stockfish is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

#include <iostream>
#include <memory>
#include <utility>

#include "attacks.h"
#include "misc.h"
#include "position.h"
#include "tune.h"
#include "uci.h"

#ifdef __EMSCRIPTEN__
    #include <emscripten/emscripten.h>
#endif

using namespace Stockfish;

#ifdef __EMSCRIPTEN__
namespace {
std::unique_ptr<UCIEngine> webUci;

UCIEngine& web_engine() {
    if (!webUci)
    {
        Attacks::init();
        Position::init();
        static char  program[] = "pikafish";
        static char* argv[] = {program};
        webUci = std::make_unique<UCIEngine>(CommandLine(1, argv));
        Tune::init(webUci->engine_options());
    }
    return *webUci;
}
}

extern "C" EMSCRIPTEN_KEEPALIVE void pikafish_command(const char* command) {
    if (command && *command)
        web_engine().command(command);
}
#endif

#ifdef UNIVERSAL_BINARY
namespace Stockfish {

int main(int argc, char* argv[]);  // silence 'no previous declaration'

__attribute__((used))  // keep main alive
#endif

int main(int argc, char* argv[]) {
#ifdef __EMSCRIPTEN__
    // The browser calls pikafish_command() from JavaScript. Do not block on stdin here.
    return 0;
#else
    std::cout << engine_info() << std::endl;

    Attacks::init();
    Position::init();

    auto cli = CommandLine(argc, argv);
    auto uci = std::make_unique<UCIEngine>(std::move(cli));

    Tune::init(uci->engine_options());

    uci->loop();

    return 0;
#endif
}

#ifdef UNIVERSAL_BINARY
}  // namespace Stockfish

    #ifdef UNIVERSAL_NEEDS_MAIN_SHIM
int main(int argc, char* argv[]) { return Stockfish::main(argc, argv); }
    #endif
#endif
