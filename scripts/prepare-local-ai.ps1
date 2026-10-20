$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$out = Join-Path $projectRoot 'src-tauri/resources/moonshine'
$stage = Join-Path $projectRoot '.build-local-ai/runtime'
New-Item -ItemType Directory -Force $stage,$out | Out-Null
$wheel = Join-Path $stage 'moonshine.zip'
$wheelUrl = 'https://files.pythonhosted.org/packages/ea/05/ad3457baa56170a13829c98327598a4d99d6cd4bdff8ae59df4c47ebdd11/moonshine_voice-0.1.5-py3-none-win_amd64.whl'
if (!(Test-Path -LiteralPath $wheel)) { Invoke-WebRequest $wheelUrl -OutFile $wheel }
if ((Get-FileHash -LiteralPath $wheel -Algorithm SHA256).Hash -ne '7FC9A84E827360DDB85C2735F44A1502C5575C27DCB476A2555646CD20A70E9D') { throw 'Moonshine runtime hash mismatch.' }
Expand-Archive -LiteralPath $wheel -DestinationPath $stage -Force
Copy-Item -LiteralPath "$stage/moonshine_voice/moonshine.dll","$stage/moonshine_voice/onnxruntime.dll" -Destination $out -Force
$portable = Join-Path $projectRoot 'tools/msvc'
$compiler = (Get-ChildItem -LiteralPath "$portable/VC/Tools/MSVC" -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName
$sdk = Join-Path $portable 'Windows Kits/10'
$sdkVersion = (Get-ChildItem -LiteralPath "$sdk/Lib" -Directory | Sort-Object Name -Descending | Select-Object -First 1).Name
$env:PATH = "$compiler/bin/Hostx64/x64;$env:PATH"
$env:LIB = "$compiler/lib/x64;$sdk/Lib/$sdkVersion/ucrt/x64;$sdk/Lib/$sdkVersion/um/x64"
$env:INCLUDE = "$compiler/include;$sdk/Include/$sdkVersion/ucrt;$sdk/Include/$sdkVersion/shared;$sdk/Include/$sdkVersion/um"
& cl.exe /nologo /std:c++17 /EHsc /O2 /MT /W4 /I native/moonshine-worker native/moonshine-worker/worker.cpp "/Fe:$out/scribly-moonshine.exe" "/Fo:$stage/worker.obj" /link /SUBSYSTEM:CONSOLE
if ($LASTEXITCODE -ne 0) { throw 'Moonshine worker compilation failed.' }
Get-ChildItem -LiteralPath src-tauri/resources/postgres/bin -Filter '*140*.dll' | Copy-Item -Destination $out -Force
& "$out/scribly-moonshine.exe" --check
if ($LASTEXITCODE -ne 0) { throw 'Moonshine ABI check failed.' }
foreach ($arch in 4,5) {
    $manifest = & "$out/scribly-moonshine.exe" --manifest $arch
    if ($LASTEXITCODE -ne 0) { throw 'Moonshine asset catalog failed.' }
    [System.IO.File]::WriteAllText((Join-Path $out "assets-$arch.json"),$manifest,[System.Text.UTF8Encoding]::new($false))
}
Copy-Item -LiteralPath "$stage/moonshine_voice-0.1.5.dist-info/licenses/LICENSE" -Destination "$out/MOONSHINE-LICENSE.txt" -Force
New-Item -ItemType Directory -Path "$out/licenses" -Force | Out-Null
Get-ChildItem -LiteralPath native/moonshine-worker/licenses -File | Copy-Item -Destination "$out/licenses" -Force
Copy-Item -LiteralPath native/moonshine-worker/NOTICE.txt -Destination "$out/NOTICE.txt" -Force
Write-Output 'Pinned speech worker and runtime prepared. Model assets are installed explicitly from Settings.'
