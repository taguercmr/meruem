# Meruem setup (Windows) — deps + thirdparty for Electron shell
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "== Meruem setup ==" -ForegroundColor Cyan

Write-Host "1) Submodules..."
git submodule update --init --recursive

Write-Host "2) Root npm install (ignore ancient postinstall)..."
npm install --no-fund --no-audit --ignore-scripts

Write-Host "3) src/ npm install..."
npm --prefix src install --production --no-fund --no-audit --ignore-scripts

Write-Host "4) Copy CodeMirror + thirdparty..."
if (-not (Test-Path "src\thirdparty\CodeMirror\lib\codemirror.js")) {
  New-Item -ItemType Directory -Force -Path "src\thirdparty\CodeMirror" | Out-Null
  Copy-Item -Recurse -Force `
    src\node_modules\codemirror\addon, `
    src\node_modules\codemirror\keymap, `
    src\node_modules\codemirror\lib, `
    src\node_modules\codemirror\mode, `
    src\node_modules\codemirror\theme `
    -Destination "src\thirdparty\CodeMirror\"
}
New-Item -ItemType Directory -Force -Path `
  "src\thirdparty\acorn\dist", `
  "src\thirdparty\preact", `
  "src\thirdparty\preact-compat", `
  "src\thirdparty\simulate-event", `
  "src\thirdparty\xtend" | Out-Null

Copy-Item -Force "src\node_modules\acorn\dist\*" "src\thirdparty\acorn\dist\"
Copy-Item -Force "src\node_modules\less\dist\less.min.js" "src\thirdparty\less.min.js" -ErrorAction SilentlyContinue
Copy-Item -Force "src\node_modules\preact-compat\dist\preact-compat.min.js" "src\thirdparty\preact-compat\"
Copy-Item -Force "src\node_modules\simulate-event\simulate-event.js" "src\thirdparty\simulate-event\"
Copy-Item -Force "src\node_modules\xtend\mutable.js", "src\node_modules\xtend\immutable.js" "src\thirdparty\xtend\"

Write-Host "5) AMD packs (semver + preact)..."
npm install semver@5.7.2 --no-save --no-fund --no-audit --ignore-scripts | Out-Null
node .\node_modules\webpack\bin\webpack.js .\node_modules\semver\semver.js .\src\thirdparty\semver.browser.js -p --output-library-target=amd | Out-Null
if (Test-Path "semver.browser.js") { Move-Item -Force "semver.browser.js" "src\thirdparty\semver.browser.js" }
node .\node_modules\webpack\bin\webpack.js .\src\node_modules\preact\dist\preact.min.js .\src\thirdparty\preact\preact.js -p --output-library-target=amd | Out-Null
if (Test-Path "preact.js") { Move-Item -Force "preact.js" "src\thirdparty\preact\preact.js" }

Write-Host "6) Default extension deps (JS hints + ESLint)..."
npm --prefix "src\extensions\default\JavaScriptCodeHints" install --no-fund --no-audit --ignore-scripts
npm --prefix "src\extensions\default\brackets-eslint" install --production --no-fund --no-audit --ignore-scripts

Write-Host "7) Electron shell..."
npm --prefix shell install --no-fund --no-audit

Write-Host ""
Write-Host "Done. Launch with: npm run dev" -ForegroundColor Green
