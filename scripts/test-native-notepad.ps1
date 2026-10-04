param([switch]$IncludeLocal, [switch]$Lint, [switch]$BuildApp)
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
if ($Lint) {
  & cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
  if ($LASTEXITCODE -ne 0) { throw 'Rust lint checks failed.' }
}
if ($BuildApp) {
  & cargo build --manifest-path src-tauri/Cargo.toml --locked
  if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
}
$testArgs = @('test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', 'notepad', '--')
if ($IncludeLocal) { $testArgs += @('--include-ignored', '--nocapture') }
& cargo @testArgs
if ($LASTEXITCODE -ne 0) { throw 'Notepad recovery tests failed.' }
