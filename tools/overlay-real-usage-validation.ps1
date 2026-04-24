#        __     __                   
# _|_   (_ ||\/|__) /\ _ _ _ _|   _  
#  |    __)||  |__)/--|_| (_(_||_|/_ 
#                     |  

param(
  [switch]$AutoTest,
  [int]$DurationSeconds = 120,
  [string]$ResultPath = "",
  [string]$ImagePath = ""
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ("LiveChatOverlayValidationNative" -as [type])) {
  Add-Type -ReferencedAssemblies @("System.Windows.Forms", "System.Drawing") @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class LiveChatOverlayValidationNative {
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
      cp.ExStyle |= LiveChatOverlayValidationNative.WS_EX_NOACTIVATE;
      cp.ExStyle |= LiveChatOverlayValidationNative.WS_EX_TOOLWINDOW;
      return cp;
    }
  }
}
"@
}

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Load-Events {
  param([string]$Root)

  $all = @()
  foreach ($file in Get-ChildItem -LiteralPath (Join-Path $Root "fixtures\replay") -Filter "*.json" | Sort-Object Name) {
    $fixture = Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json
    foreach ($event in $fixture.events) {
      $all += $event
    }
  }

  return $all | Sort-Object { [DateTime]$_.time }
}

function Set-ClickThrough {
  param(
    [System.Windows.Forms.Form]$Form,
    [bool]$Enabled
  )

  $current = [LiveChatOverlayValidationNative]::GetWindowLongPtr($Form.Handle, [LiveChatOverlayValidationNative]::GWL_EXSTYLE).ToInt64()
  $base = $current -bor [LiveChatOverlayValidationNative]::WS_EX_LAYERED -bor [LiveChatOverlayValidationNative]::WS_EX_TOOLWINDOW -bor [LiveChatOverlayValidationNative]::WS_EX_NOACTIVATE
  if ($Enabled) {
    $next = $base -bor [LiveChatOverlayValidationNative]::WS_EX_TRANSPARENT
  } else {
    $next = $base -band (-bnot [LiveChatOverlayValidationNative]::WS_EX_TRANSPARENT)
  }
  [void][LiveChatOverlayValidationNative]::SetWindowLongPtr($Form.Handle, [LiveChatOverlayValidationNative]::GWL_EXSTYLE, [IntPtr]$next)
}

function Test-ClickThrough {
  param([System.Windows.Forms.Form]$Form)
  $style = [LiveChatOverlayValidationNative]::GetWindowLongPtr($Form.Handle, [LiveChatOverlayValidationNative]::GWL_EXSTYLE).ToInt64()
  return (($style -band [LiveChatOverlayValidationNative]::WS_EX_TRANSPARENT) -ne 0)
}

function Capture-WindowRegion {
  param(
    [System.Windows.Forms.Form]$Form,
    [string]$Path
  )

  $bitmap = [System.Drawing.Bitmap]::new($Form.Width, $Form.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($Form.Left, $Form.Top, 0, 0, $Form.Size)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
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

$root = Get-RepoRoot
$tempDir = Join-Path $root "temp"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
if ([string]::IsNullOrWhiteSpace($ResultPath)) {
  $ResultPath = Join-Path $tempDir "overlay-real-usage-validation.json"
}
if ([string]::IsNullOrWhiteSpace($ImagePath)) {
  $ImagePath = Join-Path $tempDir "overlay-real-usage-validation.png"
}

$events = Load-Events -Root $root
$chatEvents = @($events | Where-Object { $_.version -eq "chat-event.v0" } | Select-Object -First 4)
$systemEvents = @($events | Where-Object { $_.version -eq "system-event.v0" } | Select-Object -First 3)
$observations = [System.Collections.Generic.List[string]]::new()
$stability = [System.Collections.Generic.List[object]]::new()
$script:HostClicks = 0

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$hostWindow = [System.Windows.Forms.Form]::new()
$hostWindow.Text = "Borderless Host Probe"
$hostWindow.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$hostWindow.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$hostWindow.Location = [System.Drawing.Point]::new($screen.X, $screen.Y)
$hostWindow.Size = [System.Drawing.Size]::new($screen.Width, $screen.Height)
$hostWindow.BackColor = [System.Drawing.Color]::FromArgb(11, 15, 22)
$hostWindow.TopMost = $false
$hostWindow.KeyPreview = $true

$hostTitle = New-Label -Text "Borderless host probe" -Left 24 -Top 20 -Width 500 -Height 30 -Color ([System.Drawing.Color]::White) -FontSize 18 -Bold $true
$hostSub = New-Label -Text "Simulacao local de app/jogo em borderless para validar overlay." -Left 24 -Top 58 -Width 780 -Height 24 -Color ([System.Drawing.Color]::FromArgb(190, 200, 215)) -FontSize 11
$hostClicksLabel = New-Label -Text "Host clicks: 0" -Left 24 -Top 94 -Width 260 -Height 24 -Color ([System.Drawing.Color]::FromArgb(125, 211, 252)) -FontSize 11 -Bold $true
$hostWindow.Controls.AddRange(@($hostTitle, $hostSub, $hostClicksLabel))

$hostWindow.Add_MouseDown({
  $script:HostClicks += 1
  $hostClicksLabel.Text = "Host clicks: $script:HostClicks"
})

$overlay = [NoActivateOverlayForm]::new()
$overlay.Text = "Overlay Probe"
$overlay.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$overlay.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$overlay.Size = [System.Drawing.Size]::new(520, 220)
$overlay.Location = [System.Drawing.Point]::new($screen.Right - 540, $screen.Top + 40)
$overlay.BackColor = [System.Drawing.Color]::FromArgb(18, 21, 27)
$overlay.Opacity = 0.86
$overlay.TopMost = $true
$overlay.ShowInTaskbar = $false

$overlay.Controls.Add((New-Label -Text "Live Control - CHAThub - validacao real" -Left 16 -Top 14 -Width 460 -Height 24 -Color ([System.Drawing.Color]::FromArgb(235,245,255)) -FontSize 12.5 -Bold $true))

$y = 48
foreach ($event in $chatEvents) {
  $text = "{0}: {1}" -f $event.author.name, $event.text
  $overlay.Controls.Add((New-Label -Text $text -Left 16 -Top $y -Width 480 -Height 24 -Color ([System.Drawing.Color]::White) -FontSize 11))
  $y += 28
}

$systemLine = "Sistema: " + (($systemEvents | ForEach-Object { $_.title }) -join " | ")
$overlay.Controls.Add((New-Label -Text $systemLine -Left 16 -Top 186 -Width 490 -Height 24 -Color ([System.Drawing.Color]::FromArgb(125,211,252)) -FontSize 9))

[System.Windows.Forms.Application]::EnableVisualStyles()

$hostWindow.Show()
[System.Windows.Forms.Application]::DoEvents()
[void][LiveChatOverlayValidationNative]::SetForegroundWindow($hostWindow.Handle)
[System.Windows.Forms.Application]::DoEvents()
Start-Sleep -Milliseconds 400
[System.Windows.Forms.Application]::DoEvents()

$foregroundAfterHost = [LiveChatOverlayValidationNative]::GetForegroundWindow()

$overlay.Show()
[System.Windows.Forms.Application]::DoEvents()
Set-ClickThrough -Form $overlay -Enabled $true
[System.Windows.Forms.Application]::DoEvents()
Start-Sleep -Milliseconds 400
[System.Windows.Forms.Application]::DoEvents()

$foregroundAfterOverlay = [LiveChatOverlayValidationNative]::GetForegroundWindow()
$observations.Add("shown")
if (Test-ClickThrough -Form $overlay) { $observations.Add("click_through_enabled") }

Capture-WindowRegion -Form $overlay -Path $ImagePath

$clickX = $overlay.Left + 30
$clickY = $overlay.Top + 30
[void][LiveChatOverlayValidationNative]::SetCursorPos($clickX, $clickY)
Start-Sleep -Milliseconds 150
[LiveChatOverlayValidationNative]::mouse_event([LiveChatOverlayValidationNative]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
[LiveChatOverlayValidationNative]::mouse_event([LiveChatOverlayValidationNative]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
[System.Windows.Forms.Application]::DoEvents()
Start-Sleep -Milliseconds 300
[System.Windows.Forms.Application]::DoEvents()

$clickPassedToHost = ($script:HostClicks -ge 1)

Start-Sleep -Milliseconds 500
$overlay.Hide()
[System.Windows.Forms.Application]::DoEvents()
$observations.Add("hidden")

Start-Sleep -Milliseconds 500
$overlay.Show()
[System.Windows.Forms.Application]::DoEvents()
Set-ClickThrough -Form $overlay -Enabled $true
[System.Windows.Forms.Application]::DoEvents()
$observations.Add("shown_again")

Start-Sleep -Milliseconds 500
$foregroundAfterShowAgain = [LiveChatOverlayValidationNative]::GetForegroundWindow()
Set-ClickThrough -Form $overlay -Enabled $false
[System.Windows.Forms.Application]::DoEvents()
if (-not (Test-ClickThrough -Form $overlay)) {
  $observations.Add("click_through_disabled")
}

$startedAt = Get-Date
$sampleSeconds = @(15, 45, 75, 105)
foreach ($seconds in $sampleSeconds) {
  if ($seconds -ge $DurationSeconds) { break }
  while ((Get-Date) -lt $startedAt.AddSeconds($seconds)) {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 250
  }
  $stability.Add([pscustomobject]@{
    second = $seconds
    overlay_visible = $overlay.Visible
    click_through = (Test-ClickThrough -Form $overlay)
    topmost = $overlay.TopMost
    foreground_is_host = ([LiveChatOverlayValidationNative]::GetForegroundWindow() -eq $hostWindow.Handle)
  })
}

$overlay.Close()
$hostWindow.Close()
[System.Windows.Forms.Application]::DoEvents()

$missing = @()
foreach ($required in @("shown","click_through_enabled","hidden","shown_again","click_through_disabled")) {
  if (-not $observations.Contains($required)) {
    $missing += $required
  }
}

$result = [ordered]@{
  ok = ($missing.Count -eq 0 -and $clickPassedToHost)
  mode = "overlay-real-usage-validation"
  auto_test = [bool]$AutoTest
  duration_seconds = $DurationSeconds
  host_borderless = $true
  overlay_visible_over_host = $true
  transparent_or_translucent = ($overlay.Opacity -lt 1)
  opacity = $overlay.Opacity
  always_on_top_requested = $overlay.TopMost
  focus_preserved_after_overlay_show = ($foregroundAfterOverlay -eq $hostWindow.Handle)
  focus_preserved_after_overlay_show_again = ($foregroundAfterShowAgain -eq $hostWindow.Handle)
  click_through_flag_observed = $observations.Contains("click_through_enabled")
  click_through_functional = $clickPassedToHost
  hide_show_observed = ($observations.Contains("hidden") -and $observations.Contains("shown_again"))
  text_corner = "top-right"
  text_legibility_probe = @{
    screenshot_path = $ImagePath
    chat_messages = $chatEvents.Count
    system_events = $systemEvents.Count
    font_size = 11
    corner = "top-right"
  }
  stability_samples = @($stability)
  observations = @($observations)
  missing = @($missing)
  host_clicks = $script:HostClicks
  limitations = @(
    "Valida comportamento sobre janela borderless local controlada, nao sobre um jogo especifico.",
    "Nao cobre anti-cheat, engine grafica ou fullscreen exclusivo.",
    "Usa PowerShell/WinForms como tooling local, nao como stack final."
  )
}

$json = $result | ConvertTo-Json -Depth 6
Set-Content -LiteralPath $ResultPath -Value $json -Encoding UTF8
[Console]::Out.WriteLine($json)
[Console]::Out.Flush()

if (-not $result.ok) {
  exit 1
}
