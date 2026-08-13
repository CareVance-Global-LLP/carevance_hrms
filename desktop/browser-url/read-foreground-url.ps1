# Reads the URL of the foreground browser window via Windows UI Automation.
#
# Runs as a long-lived helper: one line of stdin is one request, one line of
# JSON on stdout is the reply. Deliberately NOT invoked per poll — loading the
# UIA assemblies costs ~150-200ms, against ~7-12ms for a read once they are
# loaded, and main.cjs already blocks its own foreground watcher by shelling
# out with execSync.
#
# Why this exists at all: get-windows only returns a `url` on macOS, so on the
# Windows build that field has always been null and a browser with no extension
# installed produced nothing but a window title.
#
# Two sources, in preference order (measured 13 Aug 2026):
#
#   Document element   Chrome only. The real page URL including scheme, and
#                      immune to a half-typed address bar. Needs a warm-up:
#                      Chromium builds its accessibility tree lazily, so the
#                      FIRST query after a window appears returns nothing and
#                      the second succeeds.
#
#   Address bar        Edge and Brave expose only this. It holds whatever is in
#                      the box, including text typed and never submitted, which
#                      survives Escape AND focus loss. Callers must treat it as
#                      a hint - normalize-captured-url.cjs reduces it to a host
#                      and drops anything not host-shaped.

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$docCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Document
)
$barCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::NameProperty,
  'Address and search bar'
)

# Chromium-family processes whose chrome exposes one of the two sources.
# Firefox is absent on purpose: its tree differs and is untested.
$browserProcesses = @('chrome', 'msedge', 'brave', 'vivaldi', 'opera', 'opera_gx')

function Get-ElementValue($element) {
  if ($null -eq $element) { return $null }
  try {
    return $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
  } catch {
    return $null
  }
}

function Read-ForegroundUrl {
  $handle = [NativeFg]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero) {
    return [pscustomobject]@{ ok = $true; source = $null; value = $null; process = $null }
  }

  $processId = 0
  [void][NativeFg]::GetWindowThreadProcessId($handle, [ref]$processId)
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  $processName = if ($process) { $process.ProcessName.ToLowerInvariant() } else { $null }

  # Not a browser: say so rather than walking a tree that cannot hold a URL.
  if (-not $processName -or ($browserProcesses -notcontains $processName)) {
    return [pscustomobject]@{ ok = $true; source = $null; value = $null; process = $processName }
  }

  $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  if ($null -eq $root) {
    return [pscustomobject]@{ ok = $true; source = $null; value = $null; process = $processName }
  }

  # Preferred: the document's own URL.
  foreach ($document in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $docCondition)) {
    $value = Get-ElementValue $document
    if ($value -and $value -match '^[a-z][a-z0-9+.-]*://') {
      return [pscustomobject]@{ ok = $true; source = 'document'; value = $value; process = $processName }
    }
  }

  # Fallback: the address bar, which the caller must not trust as a visit.
  $bar = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $barCondition)
  $barValue = Get-ElementValue $bar
  if ($barValue) {
    return [pscustomobject]@{ ok = $true; source = 'address_bar'; value = $barValue; process = $processName }
  }

  return [pscustomobject]@{ ok = $true; source = $null; value = $null; process = $processName }
}

# Warm-up. Chromium only builds its accessibility tree once something asks, so
# the first read of a given window comes back empty. Doing it here means the
# first read the tracker actually cares about is not the wasted one.
try { $null = Read-ForegroundUrl } catch { }

[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }          # stdin closed: the parent is gone
  if ($line.Trim() -eq 'quit') { break }

  try {
    $result = Read-ForegroundUrl
  } catch {
    $result = [pscustomobject]@{ ok = $false; source = $null; value = $null; process = $null; error = $_.Exception.Message }
  }

  [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}
