$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
New-Item -ItemType Directory -Force -Path tools,src-tauri\resources | Out-Null
$archive = Join-Path $projectRoot 'tools\postgresql.zip'
# Official EDB Windows x64 PostgreSQL 18.6 distribution.
if (!(Test-Path -LiteralPath $archive)) {
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri 'https://sbp.enterprisedb.com/getfile.jsp?fileid=1260609' -OutFile $archive
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
  foreach ($entry in $zip.Entries) {
    if ($entry.FullName -match '^pgsql/(bin/|lib/|share/|server_license.txt|commandlinetools_3rd_party_licenses.txt)' -and !$entry.FullName.EndsWith('/')) {
      $relative = $entry.FullName.Substring(6)
      $destination = Join-Path $projectRoot ('src-tauri\resources\postgres\' + $relative)
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
    }
  }
} finally { $zip.Dispose() }
Write-Host 'PostgreSQL runtime prepared.'
