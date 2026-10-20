param([string]$ExecutablePath='src-tauri/target/debug/scribly.exe')
$ErrorActionPreference='Stop'
$taskWorkspace=(Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$taskExecutable=(Resolve-Path -LiteralPath $ExecutablePath).Path
$taskProfile=[IO.Path]::GetFullPath((Join-Path $taskWorkspace ('test-results-preview/local-ai-native-'+[guid]::NewGuid().ToString('N'))))
if (!$taskProfile.StartsWith(($taskWorkspace+[IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $taskProfile) -notmatch '^local-ai-native-[a-f0-9]{32}$') {throw 'Isolated profile guard failed'}
New-Item -ItemType Directory -Path $taskProfile -Force | Out-Null
foreach($taskStage in @('exercise','restart')) {
  $taskListener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$taskListener.Start();$taskPort=$taskListener.LocalEndpoint.Port;$taskListener.Stop()
  $taskPreviousArguments=$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
  try {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=$taskPort"
    $taskApp=Start-Process -FilePath $taskExecutable -ArgumentList @(('"--benchmark='+$taskProfile+'"'),'--keep-diagnostic-open') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskProfile "$taskStage-stdout.log") -RedirectStandardError (Join-Path $taskProfile "$taskStage-stderr.log")
  } finally {$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=$taskPreviousArguments}
  try {
    & node (Join-Path $PSScriptRoot 'test-native-model-setup.mjs') $taskPort $taskProfile $taskStage
    if($LASTEXITCODE -ne 0){throw "Native setup $taskStage failed. Evidence: $taskProfile"}
    if(!$taskApp.WaitForExit(35000)){throw 'Diagnostic did not shut down normally'}
  } finally {
    if(!$taskApp.HasExited){Stop-Process -Id $taskApp.Id -Force;$taskApp.WaitForExit()}
    if(Test-Path -LiteralPath (Join-Path $taskProfile 'database/postmaster.pid')){& (Join-Path $taskWorkspace 'src-tauri/resources/postgres/bin/pg_ctl.exe') -D (Join-Path $taskProfile 'database') -m fast stop | Out-Null}
  }
}
Write-Output (Join-Path $taskProfile 'model-setup-result.json')
