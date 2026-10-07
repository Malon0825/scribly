param([string]$ExecutablePath = 'src-tauri/target/debug/scribly.exe', [switch]$Silence, [switch]$SilenceOnly)
$ErrorActionPreference = 'Stop'
$taskWorkspace = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$taskExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$taskProfile = [IO.Path]::GetFullPath((Join-Path $taskWorkspace ('test-results/meetings-webview-test-' + [guid]::NewGuid().ToString('N'))))
if (!$taskProfile.StartsWith(($taskWorkspace + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $taskProfile) -notmatch '^meetings-webview-test-[a-f0-9]{32}$') { throw 'Diagnostic profile guard failed.' }
New-Item -ItemType Directory -Path $taskProfile -Force | Out-Null
$taskPgCtl = Join-Path $taskWorkspace 'src-tauri/resources/postgres/bin/pg_ctl.exe'
$taskStages = @('capture', 'recover'); if ($Silence) { $taskStages += 'silence' }
if ($SilenceOnly) { $taskStages = @('silence') }
foreach ($taskStage in $taskStages) {
  $taskListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $taskListener.Start(); $taskPort = $taskListener.LocalEndpoint.Port; $taskListener.Stop()
  $taskPreviousArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
  try {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$taskPort"
    $taskApp = Start-Process -FilePath $taskExecutable -ArgumentList @(('"--benchmark=' + $taskProfile + '"'), '--keep-diagnostic-open') -WindowStyle Hidden -PassThru
  } finally { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $taskPreviousArguments }
  try {
    & node (Join-Path $PSScriptRoot 'test-native-meetings.mjs') $taskPort $taskProfile $taskStage
    if ($LASTEXITCODE -ne 0) { throw "Native meeting $taskStage failed. Evidence: $taskProfile" }
    if ($taskStage -eq 'capture') { Stop-Process -Id $taskApp.Id -Force; $taskApp.WaitForExit() }
    elseif (!$taskApp.WaitForExit(35000)) { throw 'Diagnostic did not exit after normal shutdown.' }
  } finally {
    if (!$taskApp.HasExited) { Stop-Process -Id $taskApp.Id -Force; $taskApp.WaitForExit() }
    if (Test-Path -LiteralPath (Join-Path $taskProfile 'database/postmaster.pid')) { & $taskPgCtl -D (Join-Path $taskProfile 'database') -m fast stop | Out-Null }
  }
}
Write-Output (Join-Path $taskProfile 'meetings-test-result.json')
