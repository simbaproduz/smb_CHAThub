#        __     __                   
# _|_   (_ ||\/|__) /\ _ _ _ _|   _  
#  |    __)||  |__)/--|_| (_(_||_|/_ 
#                     |  

param(
  [switch]$AutoTest,
  [int]$DurationSeconds = 20,
  [string]$ResultPath = ""
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ("LiveChatFocusProbeNative" -as [type])) {
  Add-Type -ReferencedAssemblies @("System.Windows.Forms", "System.Drawing") @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class LiveChatFocusProbeNative {
  public const int GWL_EXSTYLE = -20;
  public const int WS_EX_TRANSPARENT = 0x00000020;
  public const int WS_EX_LAYERED = 0x00080000;
  public const int WS_EX_TOOLWINDOW = 0x00000080;
  public const int WS_EX_NOACTIVATE = 0x08000000;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;

  [DllImport("user32.dll", EntryPoint="GetWindowLong")]
  private static extern int GetWindowLong32(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", EntryPoint="SetWindowLong")]
  private static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);

  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")]
  private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")]
  private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

  public static IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, nIndex) : new IntPtr(GetWindowLong32(hWnd, nIndex));
  }

  public static IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong) {
    return IntPtr.Size == 8 ? SetWindowLongPtr64(hWnd, nIndex, dwNewLong) : new IntPtr(SetWindowLong32(hWnd, nIndex, dwNewLong.ToInt32()));
  }
}

public class NoActivateOverlayForm : Form {
  protected override bool ShowWithoutActivation {
    get { return true; }
  }

  protected override CreateParams CreateParams {
    get {
      CreateParams cp = base.CreateParams;
      cp.ExStyle |= LiveChatFocusProbeNative.WS_EX_NOACTIVATE;
      cp.ExStyle |= LiveChatFocusProbeNative.WS_EX_TOOLWINDOW;
      return cp;
    }
  }
}
"@
}

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Load-ChatLines {
  param([string]$Root)

  $all = @()
  foreach ($file in Get-ChildItem -LiteralPath (Join-Path $Root "fixtures\replay") -Filter "*.json" | Sort-Object Name) {
    $fixture = Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json
    foreach ($event in $fixture.events) {
      if ($event.version -eq "chat-event.v0") {
        $all += ("{0}: {1}" -f $event.author.name, $event.text)
      }
    }
  }

  return $all | Select-Object -First 4
}

function New-Label {
  param(
    [string]$Text,
    [int]$Left,
    [int]$Top,
    [int]$Width,
    [int]$Height,
    [System.Drawing.Color]$Color,
    [float]$FontSize,
    [bool]$Bold = $false
  )

  $label = [System.Windows.Forms.Label]::new()
  $label.Left = $Left
  $label.Top = $Top
  $label.Width = $Width
  $label.Height = $Height
  $label.ForeColor = $Color
  $label.BackColor = [System.Drawing.Color]::Transparent
  $style = if ($Bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $label.Font = [System.Drawing.Font]::new("Segoe UI", $FontSize, $style)
  $label.Text = $Text
  return $label
}

function Set-ClickThrough {
  param(
    [System.Windows.Forms.Form]$Form,
    [bool]$Enabled
  )

  $current = [LiveChatFocusProbeNative]::GetWindowLongPtr($Form.Handle, [LiveChatFocusProbeNative]::GWL_EXSTYLE).ToInt64()
  $base = $current -bor [LiveChatFocusProbeNative]::WS_EX_LAYERED -bor [LiveChatFocusProbeNative]::WS_EX_TOOLWINDOW -bor [LiveChatFocusProbeNative]::WS_EX_NOACTIVATE
  if ($Enabled) {
    $next = $base -bor [LiveChatFocusProbeNative]::WS_EX_TRANSPARENT
  } else {
    $next = $base -band (-bnot [LiveChatFocusProbeNative]::WS_EX_TRANSPARENT)
  }
  [void][LiveChatFocusProbeNative]::SetWindowLongPtr($Form.Handle, [LiveChatFocusProbeNative]::GWL_EXSTYLE, [IntPtr]$next)
}

function Test-ClickThrough {
  param([System.Windows.Forms.Form]$Form)
  $style = [LiveChatFocusProbeNative]::GetWindowLongPtr($Form.Handle, [LiveChatFocusProbeNative]::GWL_EXSTYLE).ToInt64()
  return (($style -band [LiveChatFocusProbeNative]::WS_EX_TRANSPARENT) -ne 0)
}

function Focus-IsHost {
  param([System.Windows.Forms.Form]$HostWindow)
  return ([LiveChatFocusProbeNative]::GetForegroundWindow() -eq $HostWindow.Handle)
}

$root = Get-RepoRoot
$tempDir = Join-Path $root "temp"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
if ([string]::IsNullOrWhiteSpace($ResultPath)) {
  $ResultPath = Join-Path $tempDir "overlay-focus-mitigation-probe.json"
}

$lines = Load-ChatLines -Root $root
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$observations = [System.Collections.Generic.List[string]]::new()
$samples = [System.Collections.Generic.List[object]]::new()
$script:HostClicks = 0

$hostWindow = [System.Windows.Forms.Form]::new()
$hostWindow.Text = "Focus Host Borderless Probe"
$hostWindow.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$hostWindow.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$hostWindow.Location = [System.Drawing.Point]::new($screen.X, $screen.Y)
$hostWindow.Size = [System.Drawing.Size]::new($screen.Width, $screen.Height)
$hostWindow.BackColor = [System.Drawing.Color]::FromArgb(11, 15, 22)
$hostWindow.KeyPreview = $true

$hostWindow.Controls.Add((New-Label -Text "Host borderless local" -Left 24 -Top 20 -Width 400 -Height 30 -Color ([System.Drawing.Color]::White) -FontSize 18 -Bold $true))
$hostClicksLabel = New-Label -Text "Host clicks: 0" -Left 24 -Top 58 -Width 260 -Height 24 -Color ([System.Drawing.Color]::FromArgb(125,211,252)) -FontSize 11 -Bold $true
$hostWindow.Controls.Add($hostClicksLabel)
$hostWindow.Add_MouseDown({
  $script:HostClicks += 1
  $hostClicksLabel.Text = "Host clicks: $script:HostClicks"
})

$overlay = [NoActivateOverlayForm]::new()
$overlay.Text = "Focus Overlay Probe"
$overlay.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$overlay.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$overlay.Size = [System.Drawing.Size]::new(500, 200)
$overlay.Location = [System.Drawing.Point]::new($screen.Right - 520, $screen.Top + 40)
$overlay.BackColor = [System.Drawing.Color]::FromArgb(18, 21, 27)
$overlay.Opacity = 0.86
$overlay.TopMost = $true
$overlay.ShowInTaskbar = $false
$overlay.Controls.Add((New-Label -Text "Overlay focus mitigation probe" -Left 16 -Top 14 -Width 420 -Height 24 -Color ([System.Drawing.Color]::FromArgb(235,245,255)) -FontSize 12.5 -Bold $true))

$y = 48
foreach ($line in $lines) {
  $overlay.Controls.Add((New-Label -Text $line -Left 16 -Top $y -Width 460 -Height 24 -Color ([System.Drawing.Color]::White) -FontSize 11))
  $y += 28
}

[System.Windows.Forms.Application]::EnableVisualStyles()
$hostWindow.Show()
[System.Windows.Forms.Application]::DoEvents()
[void][LiveChatFocusProbeNative]::SetForegroundWindow($hostWindow.Handle)
Start-Sleep -Milliseconds 300
[System.Windows.Forms.Application]::DoEvents()

$baselineBefore = Focus-IsHost -HostWindow $hostWindow

$overlay.Show()
[System.Windows.Forms.Application]::DoEvents()
Set-ClickThrough -Form $overlay -Enabled $true
Start-Sleep -Milliseconds 250
[System.Windows.Forms.Application]::DoEvents()
$baselineAfterShow = Focus-IsHost -HostWindow $hostWindow
if ($baselineAfterShow) { $observations.Add("baseline_focus_preserved") } else { $observations.Add("baseline_focus_lost") }

[void][LiveChatFocusProbeNative]::SetForegroundWindow($hostWindow.Handle)
Start-Sleep -Milliseconds 200
[System.Windows.Forms.Application]::DoEvents()
$mitigatedAfterReassert = Focus-IsHost -HostWindow $hostWindow
if ($mitigatedAfterReassert) { $observations.Add("focus_reasserted_after_show") }

$overlay.Hide()
[System.Windows.Forms.Application]::DoEvents()
Start-Sleep -Milliseconds 250
$overlay.Show()
[System.Windows.Forms.Application]::DoEvents()
Set-ClickThrough -Form $overlay -Enabled $true
Start-Sleep -Milliseconds 250
[void][LiveChatFocusProbeNative]::SetForegroundWindow($hostWindow.Handle)
Start-Sleep -Milliseconds 200
[System.Windows.Forms.Application]::DoEvents()
$mitigatedAfterShowAgain = Focus-IsHost -HostWindow $hostWindow
if ($mitigatedAfterShowAgain) { $observations.Add("focus_reasserted_after_show_again") }

$clickX = $overlay.Left + 30
$clickY = $overlay.Top + 30
[void][LiveChatFocusProbeNative]::SetCursorPos($clickX, $clickY)
Start-Sleep -Milliseconds 150
[LiveChatFocusProbeNative]::mouse_event([LiveChatFocusProbeNative]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
[LiveChatFocusProbeNative]::mouse_event([LiveChatFocusProbeNative]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
[System.Windows.Forms.Application]::DoEvents()
Start-Sleep -Milliseconds 300
[System.Windows.Forms.Application]::DoEvents()
$clickThroughFunctional = ($script:HostClicks -ge 1)
if ($clickThroughFunctional) { $observations.Add("click_through_functional") }

$sampleSeconds = @(5, 10, 15)
if ($DurationSeconds -ge 20) { $sampleSeconds += 20 }
$lastSampleSecond = 0
foreach ($seconds in $sampleSeconds | Sort-Object -Unique) {
  if ($seconds -ge $DurationSeconds) { break }
  $sleepSeconds = $seconds - $lastSampleSecond
  if ($sleepSeconds -gt 0) {
    Start-Sleep -Seconds $sleepSeconds
  }
  [void][LiveChatFocusProbeNative]::SetForegroundWindow($hostWindow.Handle)
  [System.Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 150
  $samples.Add([pscustomobject]@{
    second = $seconds
    foreground_is_host = (Focus-IsHost -HostWindow $hostWindow)
    click_through = (Test-ClickThrough -Form $overlay)
    overlay_visible = $overlay.Visible
    topmost = $overlay.TopMost
  })
  $lastSampleSecond = $seconds
}

$overlay.Close()
$hostWindow.Close()
[System.Windows.Forms.Application]::DoEvents()

$focusSamplesOk = (($samples | Where-Object { -not $_.foreground_is_host }).Count -eq 0)
$focusStatus = if ($baselineAfterShow -and $mitigatedAfterReassert -and $mitigatedAfterShowAgain -and $focusSamplesOk) {
  "resolvido"
} elseif ((-not $baselineAfterShow) -and $mitigatedAfterReassert -and $mitigatedAfterShowAgain) {
  "mitigado"
} elseif ((-not $baselineAfterShow) -and ($mitigatedAfterReassert -or $mitigatedAfterShowAgain)) {
  "enquadrado"
} else {
  "nao_resolvido"
}

$result = [ordered]@{
  ok = $true
  mode = "overlay-focus-mitigation-probe-local"
  duration_seconds = $DurationSeconds
  baseline_focus_before_overlay = $baselineBefore
  baseline_focus_after_overlay_show = $baselineAfterShow
  mitigated_focus_after_reassert = $mitigatedAfterReassert
  mitigated_focus_after_show_again = $mitigatedAfterShowAgain
  click_through_functional = $clickThroughFunctional
  translucency = ($overlay.Opacity -lt 1)
  opacity = $overlay.Opacity
  topmost = $overlay.TopMost
  observations = @($observations)
  stability_samples = @($samples)
  focus_status = $focusStatus
  limitations = @(
    "Mitigacao testada por reassert de foco no host local; nao define UX final.",
    "Valida host borderless local controlado, nao um jogo especifico.",
    "PowerShell/WinForms e tooling local, nao stack final."
  )
}

$json = $result | ConvertTo-Json -Depth 6
Set-Content -LiteralPath $ResultPath -Value $json -Encoding UTF8
[Console]::Out.WriteLine($json)
[Console]::Out.Flush()
