param(
  [Parameter(Mandatory=$true)][string]$ExecutablePath,
  [string]$OutputPath = '',
  [string]$DiagnosticRoot = ''
)
$ErrorActionPreference = 'Stop'
$executable = (Resolve-Path -LiteralPath $ExecutablePath).Path
if (!$DiagnosticRoot) { $DiagnosticRoot = Join-Path $env:LOCALAPPDATA ('ScriblyPerformance\' + [guid]::NewGuid().ToString('N')) }
$diagnosticDirectory = [IO.Path]::GetFullPath($DiagnosticRoot)
New-Item -ItemType Directory -Path $diagnosticDirectory -Force | Out-Null
if (!$OutputPath) { $OutputPath = Join-Path $diagnosticDirectory 'performance.json' }
function Bytes-InDirectory([string]$path) {
  if (!(Test-Path -LiteralPath $path)) { return 0 }
  return [long](Get-ChildItem -LiteralPath $path -File -Recurse | Measure-Object Length -Sum).Sum
}
function Sample-Tree([int]$appProcessId, [string]$profile) {
  $processes = @(Get-CimInstance Win32_Process)
  $ids = [Collections.Generic.HashSet[int]]::new()
  $byId = @{}
  foreach ($entry in $processes) { $byId[[int]$entry.ProcessId] = $entry }
  [void]$ids.Add($appProcessId)
  # pg_ctl exits after starting the detached PostgreSQL server. Include its PID
  # explicitly instead of losing it when reconstructing the process tree.
  $pgPidFile = Join-Path $profile 'database\postmaster.pid'
  if (Test-Path -LiteralPath $pgPidFile) { [void]$ids.Add([int](Get-Content -LiteralPath $pgPidFile -TotalCount 1)) }
  do {
    $added = $false
    foreach ($entry in $processes) {
      $parent = $byId[[int]$entry.ParentProcessId]
      if ($ids.Contains([int]$entry.ParentProcessId) -and $parent -and $entry.CreationDate -ge $parent.CreationDate -and $ids.Add([int]$entry.ProcessId)) { $added = $true }
    }
  } while ($added)
  $counters = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $ids.Contains([int]$_.IDProcess) })
  $rows = @($counters | ForEach-Object {
    $counter = $_
    $entry = $processes | Where-Object { $_.ProcessId -eq $counter.IDProcess } | Select-Object -First 1
    [pscustomobject]@{ pid=[int]$counter.IDProcess; name=$entry.Name; privateWorkingSetBytes=[long]$counter.WorkingSetPrivate; workingSetBytes=[long]$counter.WorkingSet; privateCommitBytes=[long]$counter.PrivateBytes }
  })
  if (!($rows | Where-Object { $_.pid -eq $appProcessId }) -or !($rows | Where-Object { $_.name -eq 'msedgewebview2.exe' }) -or !($rows | Where-Object { $_.name -eq 'postgres.exe' })) {
    throw 'Memory sample is missing Scribly, WebView2, or PostgreSQL; refusing a partial result.'
  }
  if ($rows | Where-Object { $_.name -notin @('scribly.exe','msedgewebview2.exe','postgres.exe') }) {
    throw 'Unexpected process in app memory sample; check process identity before reporting.'
  }
  return [pscustomobject]@{
    privateWorkingSetBytes=[long]($rows | Measure-Object privateWorkingSetBytes -Sum).Sum
    summedWorkingSetBytes=[long]($rows | Measure-Object workingSetBytes -Sum).Sum
    privateCommitBytes=[long]($rows | Measure-Object privateCommitBytes -Sum).Sum
    processes=$rows
  }
}
$runs = @()
$plan = @(
  @{ kind='first-use'; profile='profile-1' },
  @{ kind='repeat'; profile='profile-1' },
  @{ kind='repeat'; profile='profile-1' },
  @{ kind='repeat'; profile='profile-1' },
  @{ kind='first-use'; profile='profile-2' },
  @{ kind='first-use'; profile='profile-3' }
)
foreach ($item in $plan) {
  $profile = Join-Path $diagnosticDirectory $item.profile
  if ($item.kind -eq 'first-use' -and ((Test-Path -LiteralPath (Join-Path $profile 'database\PG_VERSION')) -or (Test-Path -LiteralPath (Join-Path $profile 'webview\EBWebView')))) {
    throw 'First-use measurements require a new diagnostic directory; existing profiles will not be erased.'
  }
  $readyPath = Join-Path $profile 'ready.json'
  if (Test-Path -LiteralPath $readyPath) { Remove-Item -LiteralPath $readyPath }
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $process = Start-Process -FilePath $executable -ArgumentList ('"--benchmark=' + $profile + '"') -WindowStyle Hidden -PassThru
  while (!(Test-Path -LiteralPath $readyPath)) {
    if ($process.HasExited -or $watch.Elapsed.TotalSeconds -gt 90) { throw "App did not become ready: $profile (PID $($process.Id))" }
    Start-Sleep -Milliseconds 50
  }
  $observedReadyMs = $watch.Elapsed.TotalMilliseconds
  $ready = Get-Content -LiteralPath $readyPath -Raw | ConvertFrom-Json
  Start-Sleep -Seconds 8
  $memory = Sample-Tree $process.Id $profile
  $runs += [pscustomobject]@{
    kind=$item.kind; ready=$ready; launchToObservedReadyMs=[math]::Round($observedReadyMs,1)
    memory=$memory; profile=$profile
  }
  Write-Host "$($item.kind): ready $($ready.readyMs) ms; private RAM $([math]::Round($memory.privateWorkingSetBytes/1MB,1)) MiB"
  if (!$process.WaitForExit(35000)) { throw "Diagnostic did not close itself: $($process.Id)" }
  if ($process.ExitCode -ne 0) { throw "Diagnostic exited with code $($process.ExitCode)" }
}
$payloadDirectory = Split-Path -Parent $executable
$resources = Join-Path $payloadDirectory 'postgres'
# An uninstalled release executable locates runtime resources in src-tauri/resources.
if (!(Test-Path -LiteralPath $resources)) { $resources = Join-Path (Split-Path -Parent (Split-Path -Parent $payloadDirectory)) 'resources\postgres' }
$testProfile = Join-Path $diagnosticDirectory 'profile-1'
if (!(Bytes-InDirectory (Join-Path $testProfile 'webview'))) { throw 'WebView profile was not isolated; refusing an invalid first-use result.' }
$noticesBytes = 0
foreach ($name in @('THIRD-PARTY-NOTICES.txt','FONT-LICENSES.txt','IMPORT-LICENSES.txt')) {
  $notice = Join-Path $payloadDirectory $name
  if (Test-Path -LiteralPath $notice) { $noticesBytes += (Get-Item -LiteralPath $notice).Length }
}
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$report = [pscustomobject]@{
  generatedAt=(Get-Date).ToString('o'); version=$runs[0].ready.version
  machine=[pscustomobject]@{ cpu=$cpu.Name; logicalProcessors=$cpu.NumberOfLogicalProcessors; physicalRamBytes=[long]$os.TotalVisibleMemorySize*1024; windows=$os.Caption; build=$os.BuildNumber }
  method='Release build; 1440x920 window; seed notebook plus Reference; 3 fresh database/WebView profiles and 3 restarts; ready after editable Tiptap mounts and two animation frames; idle memory sampled 8 seconds later; process tree includes detached PostgreSQL; no reboot or OS cache eviction.'
  memoryDefinition='Private working set = resident pages unique to each process. Summed working sets double-count shared pages. Private commit is reserved/committed memory, not physical RAM. Sampled idle RAM, not peak.'
  runs=$runs
  storage=[pscustomobject]@{
    executableBytes=(Get-Item -LiteralPath $executable).Length
    postgresRuntimeBytes=(Bytes-InDirectory $resources)
    noticesBytes=$noticesBytes
    applicationPayloadBytes=((Get-Item -LiteralPath $executable).Length + (Bytes-InDirectory $resources) + $noticesBytes)
    databaseBytes=(Bytes-InDirectory (Join-Path $testProfile 'database'))
    webviewProfileBytes=(Bytes-InDirectory (Join-Path $testProfile 'webview'))
    wholeProfileBytes=(Bytes-InDirectory $testProfile)
    payloadNote='Executable embeds UI and fonts. Payload estimate excludes installer/uninstaller metadata and the shared system WebView2 runtime; user profile measured after four launches.'
  }
}
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
Write-Output $OutputPath
