param([string]$ExecutablePath = 'src-tauri/target/release/scribly.exe', [switch]$ManualShortcut)
$ErrorActionPreference = 'Stop'
$executable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$taskWorkspace = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$taskProfile = Join-Path $taskWorkspace ('release/capture-webview-test-' + [guid]::NewGuid().ToString('N'))
$taskProfile = [IO.Path]::GetFullPath($taskProfile)
if (!$taskProfile.StartsWith(($taskWorkspace + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Leaf $taskProfile) -notmatch '^capture-webview-test-[a-f0-9]{32}$') { throw 'Capture diagnostic profile guard failed.' }
$taskBackupFolder = Join-Path $taskProfile 'copies'
New-Item -ItemType Directory -Path $taskBackupFolder -Force | Out-Null
$taskSettings = @{ enabled = $false; directory = $taskBackupFolder; lastAt = $null; lastRevision = $null; entries = @(); warning = $null } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $taskProfile 'backup-settings.json'), $taskSettings, [Text.UTF8Encoding]::new($false))
$taskPgCtl = Join-Path $taskWorkspace 'src-tauri/resources/postgres/bin/pg_ctl.exe'
foreach ($taskStage in @('stage1', 'stage2')) {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start(); $taskPort = $listener.LocalEndpoint.Port; $listener.Stop()
  $previousArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
  try {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$taskPort"
    $taskApp = Start-Process -FilePath $executable -ArgumentList @(('"--benchmark=' + $taskProfile + '"'), '--keep-diagnostic-open', '--test-capture-shortcuts') -WindowStyle Hidden -PassThru
  } finally { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousArguments }
  try {
    $taskNodeArguments = @((Join-Path $PSScriptRoot 'test-native-capture.mjs'), $taskPort, $taskProfile, $taskStage)
    if ($ManualShortcut -and $taskStage -eq 'stage1') { $taskNodeArguments += '--manual-shortcut' }
    & node @taskNodeArguments
    if ($LASTEXITCODE -ne 0) { throw "Native capture $taskStage failed." }
    if (!$taskApp.WaitForExit(35000)) { throw "Diagnostic did not exit: $($taskApp.Id)" }
    if ($taskApp.ExitCode -ne 0) { throw "Diagnostic exited with code $($taskApp.ExitCode)" }
    if ($taskStage -eq 'stage2') {
      $taskQueue = Get-Content -LiteralPath (Join-Path $taskProfile 'quick-capture-queue.json') -Raw -Encoding UTF8 | ConvertFrom-Json
      $taskExpectedText = 'The newest capture text survives normal main-window shutdown. ' + [char]0x65e5 + [char]0x672c + [char]0x8a9e
      if ($null -ne $taskQueue.pending -or $taskQueue.draft.title -cne 'Native main shutdown retained draft' -or
          $taskQueue.draft.text -cne $taskExpectedText) {
        throw 'Normal main shutdown did not retain the newest capture draft exactly.'
      }
      $taskReportPath = Join-Path $taskProfile 'capture.json'
      $taskReport = Get-Content -LiteralPath $taskReportPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $taskReport | Add-Member -NotePropertyName normalMainShutdownRetainsNewestCaptureDraft -NotePropertyValue $true
      [IO.File]::WriteAllText($taskReportPath, ($taskReport | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
    }
  } finally {
    if (!$taskApp.HasExited -and !$taskApp.WaitForExit(10000)) {
      # Terminate only the launcher-owned isolated app. Stop only its verified
      # diagnostic database; never enumerate or stop production app processes.
      Stop-Process -Id $taskApp.Id -Force
      $taskApp.WaitForExit()
      if (Test-Path -LiteralPath (Join-Path $taskProfile 'database/postmaster.pid')) {
        & $taskPgCtl -D (Join-Path $taskProfile 'database') -m fast stop | Out-Null
      }
    }
  }
}
Write-Output (Join-Path $taskProfile 'capture.json')
