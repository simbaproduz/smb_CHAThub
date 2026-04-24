#        __     __                   
# _|_   (_ ||\/|__) /\ _ _ _ _|   _  
#  |    __)||  |__)/--|_| (_(_||_|/_ 
#                     |  

param(
  [switch]$AutoTest,
  [int]$DurationSeconds = 4,
  [string]$ResultPath = ""
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ("LiveChatOverlayNative" -as [type])) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class LiveChatOverlayNative {
  public const int GWL_EXSTYLE = -20;
  public const int WS_EX_TRANSPARENT = 0x00000020;
  public const int WS_EX_LAYERED = 0x00080000;
  public const int WS_EX_TOOLWINDOW = 0x00000080;

  [DllImport("user32.dll", EntryPoint="GetWindowLong")]
  private static extern int GetWindowLong32(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", EntryPoint="SetWindowLong")]
  private static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);

  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")]
  private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")]
  private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

  public static IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, nIndex) : new IntPtr(GetWindowLong32(hWnd, nIndex));
  }

  public static IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong) {
    return IntPtr.Size == 8 ? SetWindowLongPtr64(hWnd, nIndex, dwNewLong) : new IntPtr(SetWindowLong32(hWnd, nIndex, dwNewLong.ToInt32()));
  }
}
"@
}

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Load-ReplayEvents {
  param([string]$Root)

  $fixtureDir = Join-Path $Root "fixtures\replay"
  $events = @()

  foreach ($file in Get-ChildItem -LiteralPath $fixtureDir -Filter "*.json" | Sort-Object Name) {
    $fixture = Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json
    foreach ($event in $fixture.events) {
      $events += $event
    }
  }

  return $events | Sort-Object { [DateTime]$_.time }
}

function Set-ClickThrough {
  param(
    [System.Windows.Forms.Form]$Form,
    [bool]$Enabled
  )

  $current = [LiveChatOverlayNative]::GetWindowLongPtr($Form.Handle, [LiveChatOverlayNative]::GWL_EXSTYLE).ToInt64()
  $base = $current -bor [LiveChatOverlayNative]::WS_EX_LAYERED -bor [LiveChatOverlayNative]::WS_EX_TOOLWINDOW

  if ($Enabled) {
    $next = $base -bor [LiveChatOverlayNative]::WS_EX_TRANSPARENT
  } else {
    $next = $base -band (-bnot [LiveChatOverlayNative]::WS_EX_TRANSPARENT)
  }

  [void][LiveChatOverlayNative]::SetWindowLongPtr($Form.Handle, [LiveChatOverlayNative]::GWL_EXSTYLE, [IntPtr]$next)
}

function Test-ClickThrough {
  param([System.Windows.Forms.Form]$Form)

  $style = [LiveChatOverlayNative]::GetWindowLongPtr($Form.Handle, [LiveChatOverlayNative]::GWL_EXSTYLE).ToInt64()
  return (($style -band [LiveChatOverlayNative]::WS_EX_TRANSPARENT) -ne 0)
}

function New-Label {
  param(
    [string]$Text,
    [int]$Top,
    [System.Drawing.Color]$Color,
    [int]$Size = 12
  )

  $label = [System.Windows.Forms.Label]::new()
  $label.AutoSize = $false
  $label.Left = 14
  $label.Top = $Top
  $label.Width = 520
  $label.Height = 24
  $label.ForeColor = $Color
  $label.BackColor = [System.Drawing.Color]::Transparent
  $label.Font = [System.Drawing.Font]::new("Segoe UI", $Size, [System.Drawing.FontStyle]::Bold)
  $label.Text = $Text
  return $label
}

$root = Get-RepoRoot
if ([string]::IsNullOrWhiteSpace($ResultPath)) {
  $resultDir = Join-Path $root "temp"
  New-Item -ItemType Directory -Force -Path $resultDir | Out-Null
  $ResultPath = Join-Path $resultDir "overlay-window-probe-result.json"
} else {
  $resultDir = Split-Path -Parent $ResultPath
  if (-not [string]::IsNullOrWhiteSpace($resultDir)) {
    New-Item -ItemType Directory -Force -Path $resultDir | Out-Null
  }
}

$events = Load-ReplayEvents -Root $root
$chatEvents = @($events | Where-Object { $_.version -eq "chat-event.v0" } | Select-Object -First 4)
$systemEvents = @($events | Where-Object { $_.version -eq "system-event.v0" } | Select-Object -First 3)
$observations = [System.Collections.Generic.List[string]]::new()
$script:AutoTestEnabled = [bool]$AutoTest
$script:ProbeResultWritten = $false

$form = [System.Windows.Forms.Form]::new()
$form.Text = "Live Control - CHAThub - Overlay Probe"
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Size = [System.Drawing.Size]::new(560, 230)
$form.Location = [System.Drawing.Point]::new(60, 60)
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(18, 21, 27)
$form.Opacity = 0.86

$title = New-Label -Text "Live Control - CHAThub - probe local" -Top 14 -Color ([System.Drawing.Color]::FromArgb(235, 245, 255)) -Size 13
$form.Controls.Add($title)

$top = 48
foreach ($event in $chatEvents) {
  $line = "{0}: {1}" -f $event.author.name, $event.text
  $form.Controls.Add((New-Label -Text $line -Top $top -Color ([System.Drawing.Color]::White) -Size 11))
  $top += 28
}

$systemSummary = "Sistema: " + (($systemEvents | ForEach-Object { $_.title }) -join " | ")
$form.Controls.Add((New-Label -Text $systemSummary -Top 188 -Color ([System.Drawing.Color]::FromArgb(125, 211, 252)) -Size 9))

$form.Add_KeyDown({
  if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
    $form.Close()
  }
})

function New-ProbeResult {
  param(
    [string[]]$Missing
  )

  return [ordered]@{
    ok = ($Missing.Count -eq 0)
    mode = "overlay-window-probe-local"
    auto_test = [bool]$AutoTest
    chat_messages = $chatEvents.Count
    system_events = $systemEvents.Count
    transparent_or_translucent = ($form.Opacity -lt 1)
    opacity = $form.Opacity
    always_on_top_requested = $true
    hide_show_observed = ($observations.Contains("hidden") -and $observations.Contains("shown_again"))
    click_through_observed = ($observations.Contains("click_through_enabled") -and $observations.Contains("click_through_disabled"))
    observations = @($observations)
    missing = @($Missing)
    result_path = $ResultPath
    limitations = @(
      "Probe valida mecanismo de janela Windows, nao valida comportamento em todos os jogos.",
      "Probe usa WinForms/PowerShell para prova local; nao define stack final de UI.",
      "Eventos sao fixtures sinteticas, sem fonte real."
    )
  }
}

function Get-MissingObservations {
  $required = @("shown", "click_through_enabled", "hidden", "shown_again", "click_through_disabled")
  $missing = @()

  if ($AutoTest) {
    foreach ($item in $required) {
      if (-not $observations.Contains($item)) {
        $missing += $item
      }
    }
  }

  return $missing
}

function Write-ProbeResult {
  if ($script:ProbeResultWritten) {
    return
  }

  $missing = @(Get-MissingObservations)
  $json = (New-ProbeResult -Missing $missing) | ConvertTo-Json -Depth 5
  Set-Content -LiteralPath $ResultPath -Value $json -Encoding UTF8
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
  $script:ProbeResultWritten = $true
}

$form.Add_FormClosed({
  Write-ProbeResult
})

$form.Add_Shown({
  if (-not $script:AutoTestEnabled) {
    $observations.Add("shown")
    Set-ClickThrough -Form $form -Enabled $true
    if (Test-ClickThrough -Form $form) {
      $observations.Add("click_through_enabled")
    }
  }
})

[System.Windows.Forms.Application]::EnableVisualStyles()

if ($script:AutoTestEnabled) {
  $form.Show()
  [System.Windows.Forms.Application]::DoEvents()
  $observations.Add("shown")

  Set-ClickThrough -Form $form -Enabled $true
  [System.Windows.Forms.Application]::DoEvents()
  if (Test-ClickThrough -Form $form) {
    $observations.Add("click_through_enabled")
  }

  Start-Sleep -Milliseconds 500
  $form.Hide()
  [System.Windows.Forms.Application]::DoEvents()
  $observations.Add("hidden")

  Start-Sleep -Milliseconds 500
  $form.Show()
  [System.Windows.Forms.Application]::DoEvents()
  $observations.Add("shown_again")

  Start-Sleep -Milliseconds 500
  Set-ClickThrough -Form $form -Enabled $false
  [System.Windows.Forms.Application]::DoEvents()
  if (-not (Test-ClickThrough -Form $form)) {
    $observations.Add("click_through_disabled")
  }

  Start-Sleep -Milliseconds ([Math]::Max(500, ($DurationSeconds * 1000) - 1500))
  $form.Close()
  [System.Windows.Forms.Application]::DoEvents()
  Write-ProbeResult

  $missing = @(Get-MissingObservations)
  if ($missing.Count -gt 0) {
    exit 1
  }
  return
}

[System.Windows.Forms.Application]::Run($form)

$missing = @(Get-MissingObservations)
if ($missing.Count -gt 0) {
  exit 1
}
