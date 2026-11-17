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

    # Check for Inno Setup compiler to optionally package installer locally
    $iscc = (Get-Command "ISCC.exe" -ErrorAction SilentlyContinue).Source
    if (-not $iscc) {
        $defaultInno = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
        if (Test-Path $defaultInno) { $iscc = $defaultInno }
    }

    if ($iscc) {
        Write-Host "Compiling Inno Setup installer..."
        New-Item -ItemType Directory -Force -Path "$repoRoot\dist" | Out-Null
        & $iscc "/DMyAppVersion=1.0.0" "/DSourceDir=$repoRoot\target\release" "$repoRoot\installer\baba-tts.iss"
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Installer generated successfully at dist\baba-tts-setup.exe"
        }
    } else {
        Write-Host "ISCC.exe not detected; skipping local installer compilation (install Inno Setup 6 to enable)."
    }
}
finally {
    Pop-Location
}
