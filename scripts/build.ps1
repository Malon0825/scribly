$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$portableTools = Join-Path $projectRoot 'tools\msvc'
if (Test-Path -LiteralPath $portableTools) {
  $compilerVersion = (Get-ChildItem -LiteralPath "$portableTools\VC\Tools\MSVC" -Directory | Sort-Object Name -Descending | Select-Object -First 1).Name
  $sdkVersion = (Get-ChildItem -LiteralPath "$portableTools\Windows Kits\10\Lib" -Directory | Sort-Object Name -Descending | Select-Object -First 1).Name
  $vc = "$portableTools\VC\Tools\MSVC\$compilerVersion"
  $sdk = "$portableTools\Windows Kits\10"
  $env:PATH = "$vc\bin\Hostx64\x64;$sdk\bin\$sdkVersion\x64;$env:PATH"
  $env:LIB = "$vc\lib\x64;$sdk\Lib\$sdkVersion\ucrt\x64;$sdk\Lib\$sdkVersion\um\x64"
  $env:INCLUDE = "$vc\include;$sdk\Include\$sdkVersion\ucrt;$sdk\Include\$sdkVersion\shared;$sdk\Include\$sdkVersion\um;$sdk\Include\$sdkVersion\winrt"
}
if (!(Test-Path -LiteralPath 'src-tauri\resources\postgres\bin\postgres.exe')) { throw 'Run scripts/prepare-postgres.ps1 first.' }
$runtimeSearch = @(
  "$portableTools\VC\Redist\MSVC\*\x64\Microsoft.VC143.CRT",
  "$env:ProgramFiles\Microsoft Visual Studio\*\*\VC\Redist\MSVC\*\x64\Microsoft.VC143.CRT"
)
if ($env:VCToolsRedistDir) { $runtimeSearch += "$env:VCToolsRedistDir\x64\Microsoft.VC143.CRT" }
$runtimeFolder = Get-Item -Path $runtimeSearch -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
if ($runtimeFolder) { Get-ChildItem -LiteralPath $runtimeFolder.FullName -Filter '*.dll' | Copy-Item -Destination src-tauri\resources\postgres\bin -Force }
if (!(Test-Path -LiteralPath 'src-tauri\resources\postgres\bin\vcruntime140.dll')) { throw 'The Visual C++ x64 redistributable DLLs are missing. Install the Visual Studio C++ build tools before packaging.' }
& npm.cmd run tauri -- build
if ($LASTEXITCODE -ne 0) { throw 'Tauri build failed.' }
New-Item -ItemType Directory -Force -Path release | Out-Null
Get-ChildItem -LiteralPath src-tauri\target\release\bundle\nsis -Filter '*.exe' | Copy-Item -Destination release
Write-Host 'Installer is in the release folder.'
