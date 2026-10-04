param([switch]$Fix, [switch]$Database)
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
$manifest = Join-Path $projectRoot 'src-tauri\Cargo.toml'
if ($Fix) { & cargo fmt --manifest-path $manifest }
else { & cargo fmt --manifest-path $manifest -- --check }
if ($LASTEXITCODE -ne 0) { throw 'Rust formatting failed.' }
& cargo clippy --manifest-path $manifest --locked --all-targets -- -D warnings
if ($LASTEXITCODE -ne 0) { throw 'Rust lint checks failed.' }
& cargo test --manifest-path $manifest --locked
if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed.' }
if ($Database) {
  & cargo test --manifest-path $manifest --locked -- --ignored
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL integration tests failed.' }
}
