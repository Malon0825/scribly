param([string]$ExecutablePath = 'src-tauri/target/release/scribly.exe')
$ErrorActionPreference = 'Stop'
$captureWorkspace = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$captureExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$captureRoot = [IO.Path]::GetFullPath((Join-Path $captureWorkspace ('release/capture-conflict-test-' + [guid]::NewGuid().ToString('N'))))
if (!$captureRoot.StartsWith(($captureWorkspace + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $captureRoot) -notmatch '^capture-conflict-test-[a-f0-9]{32}$') { throw 'Isolated capture conflict profile guard failed.' }
$captureApps = @(); $capturePorts = @()
try {
  foreach ($captureName in @('first', 'second')) {
    $captureProfile = Join-Path $captureRoot $captureName
    New-Item -ItemType Directory -Path $captureProfile -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $captureProfile 'backup-settings.json'), (@{ enabled=$false; directory=$null; lastAt=$null; lastRevision=$null; entries=@(); warning=$null } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $captureListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $captureListener.Start(); $capturePort = $captureListener.LocalEndpoint.Port; $captureListener.Stop()
    $capturePorts += $capturePort
    $capturePreviousArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
    try {
      $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$capturePort"
      $captureApps += Start-Process -FilePath $captureExecutable -ArgumentList @(('"--benchmark=' + $captureProfile + '"'), '--keep-diagnostic-open', '--test-capture-shortcuts') -WindowStyle Hidden -PassThru
    } finally { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $capturePreviousArguments }
    & node (Join-Path $PSScriptRoot 'test-native-capture-conflict.mjs') $captureName $captureRoot @capturePorts
    if ($LASTEXITCODE -ne 0) { throw "Capture conflict $captureName stage failed; see $captureRoot/capture-conflict.json" }
  }
  foreach ($captureApp in $captureApps) { if (!$captureApp.WaitForExit(35000) -or $captureApp.ExitCode -ne 0) { throw 'Isolated capture conflict application failed to exit cleanly.' } }
} finally {
  foreach ($captureApp in $captureApps) { if (!$captureApp.HasExited) { Stop-Process -Id $captureApp.Id -Force; $captureApp.WaitForExit(10000) | Out-Null } }
  foreach ($captureName in @('first', 'second')) {
    $captureDatabase = Join-Path $captureRoot "$captureName/database"
    if (Test-Path -LiteralPath (Join-Path $captureDatabase 'postmaster.pid')) {
      & (Join-Path $captureWorkspace 'src-tauri/resources/postgres/bin/pg_ctl.exe') -D $captureDatabase -m fast -w -t 10 stop | Out-Null
    }
  }
}
Write-Output (Join-Path $captureRoot 'capture-conflict.json')
