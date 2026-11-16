$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
    npm ci --prefix frontend
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }

    npm run build --prefix frontend
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }

    cargo build --release
    if ($LASTEXITCODE -ne 0) { throw 'Rust release build failed.' }
}
finally {
    Pop-Location
}
