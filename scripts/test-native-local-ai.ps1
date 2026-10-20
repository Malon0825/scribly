param([string]$ExecutablePath='src-tauri/target/debug/scribly.exe',[switch]$Speech,[ValidateSet('moonshine','moonshine-small')][string]$SpeechModel='moonshine',[switch]$SummaryQuality,[string]$TranscriptPath='',[switch]$SkipRecapChecks)
$ErrorActionPreference='Stop'
$taskWorkspace=(Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$taskExecutable=(Resolve-Path -LiteralPath $ExecutablePath).Path
$taskProfile=[IO.Path]::GetFullPath((Join-Path $taskWorkspace ('test-results-preview/local-ai-native-'+[guid]::NewGuid().ToString('N'))))
if (!$taskProfile.StartsWith(($taskWorkspace+[IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $taskProfile) -notmatch '^local-ai-native-[a-f0-9]{32}$') {throw 'Isolated profile guard failed'}
New-Item -ItemType Directory -Path $taskProfile -Force | Out-Null
if ($SummaryQuality -and $TranscriptPath) {Copy-Item -LiteralPath (Resolve-Path -LiteralPath $TranscriptPath).Path -Destination (Join-Path $taskProfile 'recording.json')}
if ($Speech) {
  Add-Type -AssemblyName System.Speech
  $taskSynth=[System.Speech.Synthesis.SpeechSynthesizer]::new()
  try {
    $taskFormat=[System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
    $taskSynth.SetOutputToWaveFile((Join-Path $taskProfile 'speech-fixture.wav'),$taskFormat)
    $taskVoices=$taskSynth.GetInstalledVoices()
    $taskSynth.SelectVoice($taskVoices[0].VoiceInfo.Name)
    $taskSynth.Speak('I am Sam. I will review the prototype on Tuesday. The design is ready for testing. We still need to decide the budget.')
    $taskSynth.SelectVoice($taskVoices[$taskVoices.Count-1].VoiceInfo.Name)
    $taskSynth.Speak('I am Jordan. I will write the release notes on Friday. Sam will review the prototype. The budget is still an open question.')
  } finally {$taskSynth.Dispose()}
}
foreach ($taskStage in @('exercise','restart')) {
  $taskListener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$taskListener.Start();$taskPort=$taskListener.LocalEndpoint.Port;$taskListener.Stop()
  $taskPreviousArguments=$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
  try {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=$taskPort"
    $taskApp=Start-Process -FilePath $taskExecutable -ArgumentList @(('"--benchmark='+$taskProfile+'"'),'--keep-diagnostic-open') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskProfile "$taskStage-stdout.log") -RedirectStandardError (Join-Path $taskProfile "$taskStage-stderr.log")
  } finally {$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=$taskPreviousArguments}
  try {
    $taskRunner = if ($SummaryQuality) {'test-native-local-summary.mjs'} else {'test-native-local-ai.mjs'}
    & node (Join-Path $PSScriptRoot $taskRunner) $taskPort $taskProfile $taskStage $(if ($Speech) {'speech'} else {'text'}) $SpeechModel $(if ($taskExecutable -match '[\\/]release[\\/]') {'production'} else {'development'}) $(if ($SkipRecapChecks) {'skip-recap'} else {'all'})
    if ($LASTEXITCODE -ne 0) {throw "Local AI $taskStage failed. Evidence: $taskProfile"}
    if (!$taskApp.WaitForExit(35000)) {throw 'Diagnostic did not shut down normally'}
  } finally {
    if (!$taskApp.HasExited) {Stop-Process -Id $taskApp.Id -Force;$taskApp.WaitForExit()}
    if (Test-Path -LiteralPath (Join-Path $taskProfile 'database/postmaster.pid')) {& (Join-Path $taskWorkspace 'src-tauri/resources/postgres/bin/pg_ctl.exe') -D (Join-Path $taskProfile 'database') -m fast stop | Out-Null}
  }
}
Write-Output (Join-Path $taskProfile $(if ($SummaryQuality) {'summary-quality.json'} else {'local-ai-result.json'}))
