param([string]$ExecutablePath = 'src-tauri/target/release/scribly.exe')
$ErrorActionPreference = 'Stop'
$executable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$taskProfile = Join-Path (Split-Path -Parent $PSScriptRoot) ('release/formatted-webview-test-' + [guid]::NewGuid().ToString('N'))
$taskBackupFolder = Join-Path $taskProfile 'copies'
New-Item -ItemType Directory -Path $taskBackupFolder -Force | Out-Null
$taskSettings = @{ enabled = $false; directory = $taskBackupFolder; lastAt = $null; lastRevision = $null; entries = @(); warning = $null } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $taskProfile 'backup-settings.json'), $taskSettings, [Text.UTF8Encoding]::new($false))
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start(); $taskPort = $listener.LocalEndpoint.Port; $listener.Stop()
$previousArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
try {
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$taskPort"
  $taskApp = Start-Process -FilePath $executable -ArgumentList @(('"--benchmark=' + $taskProfile + '"'), '--keep-diagnostic-open') -WindowStyle Hidden -PassThru
} finally { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousArguments }
try {
  & node (Join-Path $PSScriptRoot 'test-native-formatted.mjs') $taskPort $taskProfile
  if ($LASTEXITCODE -ne 0) { throw 'Native formatted checks failed.' }
  if (!$taskApp.WaitForExit(35000)) { throw "Diagnostic did not exit: $($taskApp.Id)" }
  if ($taskApp.ExitCode -ne 0) { throw "Diagnostic exited with code $($taskApp.ExitCode)" }
  Write-Output (Join-Path $taskProfile 'formatted.json')
} finally {
  if (!$taskApp.HasExited -and !$taskApp.WaitForExit(25000)) {
    # If graceful close fails, terminate only this isolated diagnostic process.
    Stop-Process -Id $taskApp.Id -Force
    $taskApp.WaitForExit()
    $taskPgCtl = Join-Path (Split-Path -Parent $PSScriptRoot) 'src-tauri/resources/postgres/bin/pg_ctl.exe'
    & $taskPgCtl -D (Join-Path $taskProfile 'database') -m fast stop | Out-Null
  }
}
