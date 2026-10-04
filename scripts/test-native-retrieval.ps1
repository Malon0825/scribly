param([string]$ExecutablePath = 'src-tauri/target/release/scribly.exe')
$ErrorActionPreference = 'Stop'
$executable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$taskProfile = Join-Path (Split-Path -Parent $PSScriptRoot) ('release/retrieval-webview-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskProfile | Out-Null
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start(); $taskPort = $listener.LocalEndpoint.Port; $listener.Stop()
$previousArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
try {
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$taskPort"
  $taskApp = Start-Process -FilePath $executable -ArgumentList @(('"--benchmark=' + $taskProfile + '"'), '--keep-diagnostic-open') -WindowStyle Hidden -PassThru
} finally { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousArguments }
try {
  & node (Join-Path $PSScriptRoot 'test-native-retrieval.mjs') $taskPort $taskProfile
  if ($LASTEXITCODE -ne 0) { throw 'Native retrieval checks failed.' }
  if (!$taskApp.WaitForExit(35000)) { throw "Diagnostic did not exit: $($taskApp.Id)" }
  if ($taskApp.ExitCode -ne 0) { throw "Diagnostic exited with code $($taskApp.ExitCode)" }
  Write-Output (Join-Path $taskProfile 'retrieval.json')
} finally {
  if (!$taskApp.HasExited -and !$taskApp.WaitForExit(25000)) {
    # A failed-save fixture deliberately vetoes normal close; only terminate this test process.
    Stop-Process -Id $taskApp.Id -Force
    $taskApp.WaitForExit()
    $taskPgCtl = Join-Path (Split-Path -Parent $PSScriptRoot) 'src-tauri/resources/postgres/bin/pg_ctl.exe'
    & $taskPgCtl -D (Join-Path $taskProfile 'database') -m fast stop | Out-Null
  }
}
