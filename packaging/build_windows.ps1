# Build the Windows app and its installer.
#   powershell -ExecutionPolicy Bypass -File packaging\build_windows.ps1
# Needs: Python 3.12 with requirements-gui.txt + pyinstaller, and Inno Setup 6.
param([string]$Python = "python")

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$version = & $Python -c "from gui.version import VERSION; print(VERSION)"
if (-not $version) { throw "Cannot read the app version." }

& $Python packaging\fetch_whisper.py windows
if ($LASTEXITCODE -ne 0) { throw "fetch_whisper failed" }

& $Python -m PyInstaller --noconfirm --distpath dist --workpath build\pyinstaller packaging\language_tutor.spec
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

$iscc = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "Inno Setup 6 (ISCC.exe) not found." }

& $iscc "/DAppVersion=$version" packaging\windows\installer.iss
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed" }

Write-Output "Built dist\LanguageTutor-Setup-$version.exe"
