# Graph Lab: building the Windows app

The ready-to-run app is GraphLab-1.1-win64.zip. Use this folder only if you want to
change the app or produce a Windows installer.

## Folder layout

    GraphLab-source/
      app/          the app (Electron): main.js, preload.js, index.html, three.min.js, graphlab.h, icon.png
      mingw/        the C++ compiler. NOT included here: copy the folder
                    GraphLab\resources\mingw out of GraphLab-1.1-win64.zip

## Run it from source (on Windows)

1. Install Node.js 20 or newer from nodejs.org.
2. In a terminal inside `app`:

       npm install
       npm start

## Make an installer and a single-file portable .exe

    npm run dist

electron-builder writes both into `app/dist/`: an installer (Graph Lab Setup 1.1.0.exe)
with Start-menu and desktop shortcuts, and a portable exe. The compiler is copied in from
`../mingw` automatically (see "extraResources" in package.json). The installer also gets
the icon embedded, which the portable zip build doesn't have.

## Where things live

- Learners: %APPDATA%\Graph Lab\profiles.json. Progress: one progress-<id>.json per learner (plus .bak).
- Program input is passed as a file, never through a stdin pipe (closing a child's stdin pipe right
  after spawning froze Electron's main process in testing).
- Compiling: main.js, handler "cpp:run". Flags: -std=c++23 -O0 -static -include graphlab.h.
  Time limit 4 s per run, 60 s per compile; output capped at 200 KB; trace capped at 6,000 events.
- If the bundled compiler is missing, the app falls back to any g++ on PATH (e.g. Code::Blocks).
- The page is the same index.html as the claude.ai version, except three.js loads from the
  local file so the 3D views work offline.
