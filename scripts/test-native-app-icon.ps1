param([string]$ExecutablePath = 'src-tauri/target/release/scribly.exe')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ScriblyIconProbe {
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int index);
    [StructLayout(LayoutKind.Sequential)]
    public struct PropertyKey { public Guid format; public uint id; }
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    public struct PropertyValue {
        [FieldOffset(0)] public ushort type;
        [FieldOffset(8)] public IntPtr text;
    }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface PropertyStore {
        void GetCount(out uint count);
        void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropertyValue value);
        void SetValue(ref PropertyKey key, ref PropertyValue value);
        void Commit();
    }
    [DllImport("shell32.dll", PreserveSig = false)]
    static extern void SHGetPropertyStoreForWindow(IntPtr window, ref Guid iid, out PropertyStore store);
    [DllImport("ole32.dll")]
    static extern int PropVariantClear(ref PropertyValue value);
    public static string ShellProperty(IntPtr window, uint id) {
        var iid = typeof(PropertyStore).GUID;
        PropertyStore store;
        SHGetPropertyStoreForWindow(window, ref iid, out store);
        var key = new PropertyKey { format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), id = id };
        PropertyValue value;
        try {
            store.GetValue(ref key, out value);
            try { return value.type == 31 ? Marshal.PtrToStringUni(value.text) : null; }
            finally { PropVariantClear(ref value); }
        } finally { Marshal.ReleaseComObject(store); }
    }
}
'@
function Read-Icon([IntPtr]$window, [int]$slot) {
    $handle = [ScriblyIconProbe]::SendMessage($window, 0x7F, [IntPtr]$slot, [IntPtr]::Zero)
    if ($handle -eq [IntPtr]::Zero) { throw "Windows icon slot $slot is empty" }
    # Copy the borrowed native icon before inspecting it; never destroy the
    # handle owned by Scribly. ToBitmap gives the pixels Windows will render.
    $copy = [System.Drawing.Icon]::FromHandle($handle).Clone()
    $bitmap = $copy.ToBitmap()
    try {
        $blue = 0; $sand = 0
        for ($y = 0; $y -lt $bitmap.Height; $y++) {
            for ($x = 0; $x -lt $bitmap.Width; $x++) {
                $pixel = $bitmap.GetPixel($x, $y)
                if ($pixel.A -lt 100) { continue }
                if ($pixel.B -gt 120 -and $pixel.B -gt $pixel.R * 1.2) { $blue++ }
                if ($pixel.R -gt 120 -and $pixel.R -gt $pixel.B * 1.2) { $sand++ }
            }
        }
        return @{ handle=$handle.ToInt64(); width=$bitmap.Width; height=$bitmap.Height; blue=$blue; sand=$sand }
    } finally { $bitmap.Dispose(); $copy.Dispose() }
}
$executable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$taskIconProfile = Join-Path (Split-Path -Parent $PSScriptRoot) ('release/icon-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskIconProfile | Out-Null
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
$previousArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
try {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port"
    $app = Start-Process -FilePath $executable -ArgumentList ('"--benchmark=' + $taskIconProfile + '"') -WindowStyle Hidden -PassThru
} finally { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousArguments }
$runner = [Diagnostics.Process]::new()
$runner.StartInfo = [Diagnostics.ProcessStartInfo]::new('node', ('"' + (Join-Path $PSScriptRoot 'test-native-app-icon.mjs') + '" ' + $port))
$runner.StartInfo.UseShellExecute = $false
$runner.StartInfo.CreateNoWindow = $true
$runner.StartInfo.RedirectStandardInput = $true
$runner.StartInfo.RedirectStandardOutput = $true
$runner.StartInfo.RedirectStandardError = $true
$samples = @(); $cached = @{}
try {
    [void]$runner.Start()
    while ($null -ne ($line = $runner.StandardOutput.ReadLine())) {
        $request = $line | ConvertFrom-Json
        $app.Refresh()
        if ($app.HasExited -or $app.MainWindowHandle -eq [IntPtr]::Zero) { throw 'Diagnostic window closed before verification' }
        $small = Read-Icon $app.MainWindowHandle 0
        $large = Read-Icon $app.MainWindowHandle 1
        # Windows 11 may ignore a caption-sized ICON_SMALL when the taskbar
        # needs a larger image. Check actual native pixels against its metric,
        # not merely the handle's theme or the Shell resource string.
        if ($small.width -lt [ScriblyIconProbe]::GetSystemMetrics(11)) { throw 'Taskbar-facing icon is smaller than the Windows large-icon metric' }
        $shell = @{
            appId=[ScriblyIconProbe]::ShellProperty($app.MainWindowHandle, 5)
            icon=[ScriblyIconProbe]::ShellProperty($app.MainWindowHandle, 3)
            command=[ScriblyIconProbe]::ShellProperty($app.MainWindowHandle, 2)
            name=[ScriblyIconProbe]::ShellProperty($app.MainWindowHandle, 4)
        }
        $expectedShellFile = if ($request.dark) { 'scribly-dark.ico,0' } else { 'scribly-light.ico,0' }
        if ($shell.appId -ne 'com.still.notes' -or !$shell.icon -or !$shell.icon.EndsWith($expectedShellFile)) {
            throw "Taskbar-group icon is not theme-aware at $($request.stage): $($shell | ConvertTo-Json -Compress)"
        }
        if ($shell.command -ne ('"' + $executable + '"') -or $shell.name -ne 'Scribly') { throw 'Taskbar relaunch identity is incorrect' }
        $shellIconPath = $shell.icon.Substring(0, $shell.icon.Length - 2)
        if (!(Test-Path -LiteralPath $shellIconPath)) { throw 'Taskbar icon resource is missing' }
        $sourceIcon = if ($request.dark) { 'icon-dark.ico' } else { 'icon.ico' }
        $sourceIcon = Join-Path (Split-Path -Parent $PSScriptRoot) ('src-tauri/icons/' + $sourceIcon)
        if ((Get-FileHash -LiteralPath $shellIconPath).Hash -ne (Get-FileHash -LiteralPath $sourceIcon).Hash) { throw 'Taskbar resource does not match the bundled artwork' }
        $resourceTime = (Get-Item -LiteralPath $shellIconPath).LastWriteTimeUtc.Ticks
        foreach ($icon in @($small, $large)) {
            if ($request.dark) {
                if ($icon.sand -le $icon.blue -or $icon.sand -lt 3) { throw "Expected dark artwork at $($request.stage)" }
            } elseif ($icon.blue -le $icon.sand -or $icon.blue -lt 3) { throw "Expected light artwork at $($request.stage)" }
        }
        $theme = if ($request.dark) { 'dark' } else { 'light' }
        if ($cached.ContainsKey($theme)) {
            if ($cached[$theme].small -ne $small.handle -or $cached[$theme].large -ne $large.handle) { throw 'Native icon handles were not reused' }
            if ($cached[$theme].resource -ne $shell.icon -or $cached[$theme].resourceTime -ne $resourceTime) { throw 'Taskbar resource was rewritten during a mode switch' }
        } else { $cached[$theme] = @{ small=$small.handle; large=$large.handle; resource=$shell.icon; resourceTime=$resourceTime } }
        $samples += @{ stage=$request.stage; small=$small; large=$large; shell=$shell }
        $runner.StandardInput.WriteLine('ok')
    }
    $runner.WaitForExit()
    if ($runner.ExitCode -ne 0) { throw $runner.StandardError.ReadToEnd() }
    if ($samples.Count -ne 7) { throw 'Missing native icon samples' }
    if ($cached.light.small -eq $cached.dark.small -or $cached.light.large -eq $cached.dark.large) { throw 'Themes share the same native icon' }
    if (!$app.WaitForExit(25000)) { throw 'Diagnostic app did not shut down cleanly' }
    if ($app.ExitCode -ne 0) { throw "Diagnostic app crashed during icon cleanup: $($app.ExitCode)" }
    @{ ok=$true; executable=$executable; samples=$samples } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskIconProfile 'icons.json')
    Write-Host "PASS: caption, large window and Shell taskbar-group icons follow Light/Dark/System, rapid reversals, and reload; cached handles reused. Report: $taskIconProfile/icons.json"
} finally {
    if ($runner.Id -and !$runner.HasExited) { $runner.StandardInput.Close(); $runner.Kill() }
    # The benchmark closes itself and its isolated PostgreSQL after 20 seconds.
    if ($app -and !$app.HasExited) { [void]$app.WaitForExit(25000) }
    $runner.Dispose()
}
