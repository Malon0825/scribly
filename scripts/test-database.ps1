param(
  [string]$ExecutablePath = '',
  [string]$TestDataPath = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (!$ExecutablePath) { $ExecutablePath = Join-Path $projectRoot 'src-tauri\target\release\scribly.exe' }
if (!$TestDataPath) { $TestDataPath = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('StillNotesDiagnostics\Notebook-' + [guid]::NewGuid().ToString('N')) }
$executable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$testDirectory = [IO.Path]::GetFullPath($TestDataPath)
$process = Start-Process -FilePath $executable -ArgumentList ('"--self-test=' + $testDirectory + '"') -WindowStyle Hidden -PassThru
if (!$process.WaitForExit(60000)) { throw "Database diagnostic timed out. Test process: $($process.Id); data: $testDirectory" }
$reportPath = Join-Path $testDirectory 'self-test.json'
if (!(Test-Path -LiteralPath $reportPath)) { throw "Diagnostic report was not created (exit $($process.ExitCode))." }
$report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
if ($process.ExitCode -ne 0 -or !$report.ok) { throw "Database diagnostic failed: $($report.error)" }
Write-Output $report
