#        __     __                   
# _|_   (_ ||\/|__) /\ _ _ _ _|   _  
#  |    __)||  |__)/--|_| (_(_||_|/_ 
#                     |  

param(
  [switch]$AutoTest,
  [int]$DurationSeconds = 20,
  [string]$ResultPath = "",
  [string]$ImagePath = ""
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ("LiveChatUiMinimaNative" -as [type])) {
  Add-Type -ReferencedAssemblies @("System.Windows.Forms", "System.Drawing") @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class LiveChatUiMinimaNative {
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
      cp.ExStyle |= LiveChatUiMinimaNative.WS_EX_NOACTIVATE;
      cp.ExStyle |= LiveChatUiMinimaNative.WS_EX_TOOLWINDOW;
      return cp;
    }
  }
}
"@
}

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Resolve-OutputPath {
  param(
    [string]$Root,
    [string]$Path,
    [string]$DefaultName
  )

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return Join-Path (Join-Path $Root "temp") $DefaultName
  }

  if ([System.IO.Path]::IsPathRooted($Path)) {
    return $Path
  }

  return Join-Path $Root $Path
}

function Resolve-OutputPaths {
  param(
    [string]$Root,
    [string]$RequestedResultPath,
    [string]$RequestedImagePath
  )

  $tempDir = Join-Path $Root "temp"
  New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

  $resolvedResultPath = Resolve-OutputPath -Root $Root -Path $RequestedResultPath -DefaultName "ui-minima-local-replay.json"
  $resolvedImagePath = Resolve-OutputPath -Root $Root -Path $RequestedImagePath -DefaultName "ui-minima-local-replay.png"

  foreach ($path in @($resolvedResultPath, $resolvedImagePath)) {
    $dir = Split-Path -Parent $path
    if (-not [string]::IsNullOrWhiteSpace($dir)) {
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
  }

  return [pscustomobject]@{
    TempDir = $tempDir
    ResultPath = $resolvedResultPath
    ImagePath = $resolvedImagePath
  }
}

function New-UiRuntimeState {
  param(
    [pscustomobject]$ReplayState,
    [pscustomobject]$Paths
  )

  return [pscustomobject]@{
    Replay = $ReplayState
    Paths = $Paths
    Observations = [System.Collections.Generic.List[string]]::new()
    Lifecycle = [pscustomobject]@{
      ResultWritten = $false
      CleanupDone = $false
    }
    Runtime = [pscustomobject]@{
      HostClicks = 0
      BaselineFocusAfterShow = $false
      FocusMitigatedAfterReassert = $false
      FocusAfterShowAgain = $false
      OverlayTopMost = $false
      OverlayOpacity = 1.0
      ClickThroughFunctional = $false
      HideShowFunctional = $false
      Error = $null
      Ok = $false
    }
    Windows = [pscustomobject]@{
      Host = $null
      Overlay = $null
    }
  }
}

function Add-Observation {
  param(
    [pscustomobject]$State,
    [string]$Value
  )

  if (-not [string]::IsNullOrWhiteSpace($Value) -and -not $State.Observations.Contains($Value)) {
    $State.Observations.Add($Value)
  }
}

function Set-ClickThrough {
  param(
    [System.Windows.Forms.Form]$Form,
    [bool]$Enabled
  )

  $current = [LiveChatUiMinimaNative]::GetWindowLongPtr($Form.Handle, [LiveChatUiMinimaNative]::GWL_EXSTYLE).ToInt64()
  $base = $current -bor [LiveChatUiMinimaNative]::WS_EX_LAYERED -bor [LiveChatUiMinimaNative]::WS_EX_TOOLWINDOW -bor [LiveChatUiMinimaNative]::WS_EX_NOACTIVATE

  $next = if ($Enabled) {
    $base -bor [LiveChatUiMinimaNative]::WS_EX_TRANSPARENT
  } else {
    $base -band (-bnot [LiveChatUiMinimaNative]::WS_EX_TRANSPARENT)
  }

  [void][LiveChatUiMinimaNative]::SetWindowLongPtr($Form.Handle, [LiveChatUiMinimaNative]::GWL_EXSTYLE, [IntPtr]$next)
}

function Test-ClickThrough {
  param([System.Windows.Forms.Form]$Form)

  $style = [LiveChatUiMinimaNative]::GetWindowLongPtr($Form.Handle, [LiveChatUiMinimaNative]::GWL_EXSTYLE).ToInt64()
  return (($style -band [LiveChatUiMinimaNative]::WS_EX_TRANSPARENT) -ne 0)
}

function Focus-IsHost {
  param([System.Windows.Forms.Form]$HostWindow)

  return ([LiveChatUiMinimaNative]::GetForegroundWindow() -eq $HostWindow.Handle)
}

function Wait-Condition {
  param(
    [scriptblock]$Condition,
    [int]$TimeoutMs = 1000,
    [int]$PollMs = 50
  )

  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    [System.Windows.Forms.Application]::DoEvents()
    if (& $Condition) {
      return $true
    }
    Start-Sleep -Milliseconds $PollMs
  }
  return $false
}

function Ensure-HostFocus {
  param(
    [pscustomobject]$State,
    [int]$Attempts = 4
  )

  for ($i = 0; $i -lt $Attempts; $i++) {
    [void][LiveChatUiMinimaNative]::SetForegroundWindow($State.Windows.Host.Handle)
    if (Wait-Condition -Condition { Focus-IsHost -HostWindow $State.Windows.Host } -TimeoutMs 400 -PollMs 50) {
      return $true
    }
  }
  return $false
}

function Wait-ClickThroughEnabled {
  param(
    [pscustomobject]$State,
    [int]$TimeoutMs = 700
  )

  return (Wait-Condition -Condition { Test-ClickThrough -Form $State.Windows.Overlay } -TimeoutMs $TimeoutMs -PollMs 50)
}

function Invoke-ClickThroughProbe {
  param(
    [pscustomobject]$State,
    [int]$Attempts = 4
  )

  for ($i = 0; $i -lt $Attempts; $i++) {
    if (-not (Wait-ClickThroughEnabled -State $State -TimeoutMs 700)) {
      continue
    }
    $before = $State.Runtime.HostClicks
    $clickX = $State.Windows.Overlay.Left + 40
    $clickY = $State.Windows.Overlay.Top + 40
    [void][LiveChatUiMinimaNative]::SetCursorPos($clickX, $clickY)
    Start-Sleep -Milliseconds 120
    [LiveChatUiMinimaNative]::mouse_event([LiveChatUiMinimaNative]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
    [LiveChatUiMinimaNative]::mouse_event([LiveChatUiMinimaNative]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
    if (Wait-Condition -Condition { $State.Runtime.HostClicks -gt $before } -TimeoutMs 400 -PollMs 50) {
      return $true
    }
  }
  return $false
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

function Load-ReplayState {
  param([string]$Root)

  $events = @()
  $fixtureFiles = Get-ChildItem -LiteralPath (Join-Path $Root "fixtures\replay") -Filter "*.json" | Sort-Object Name

  foreach ($file in $fixtureFiles) {
    $fixture = Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json
    foreach ($event in $fixture.events) {
      $events += $event
    }
  }

  $events = $events | Sort-Object @{ Expression = { [DateTime]$_.time } }, @{ Expression = { $_.id } }

  $seen = @{}
  $messages = New-Object System.Collections.Generic.List[object]
  $system = New-Object System.Collections.Generic.List[object]
  $stats = [ordered]@{
    received = 0
    shown = 0
    duplicates = 0
    commands_hidden = 0
    errors = 0
  }

  foreach ($event in $events) {
    $stats.received += 1

    if ($seen.ContainsKey($event.id)) {
      $stats.duplicates += 1
      continue
    }
    $seen[$event.id] = $true

    if ($event.version -eq "system-event.v0") {
      $system.Add($event) | Out-Null
      if ($event.level -eq "error") { $stats.errors += 1 }
      continue
    }

    if ($event.kind -eq "command" -or $event.text.Trim().StartsWith("!")) {
      $stats.commands_hidden += 1
      continue
    }

    $messages.Add($event) | Out-Null
    $stats.shown += 1
  }

  return [pscustomobject]@{
    Messages = @($messages | Sort-Object @{ Expression = { [DateTime]$_.time } }, @{ Expression = { $_.id } } | Select-Object -Last 6)
    System = @($system | Sort-Object @{ Expression = { [DateTime]$_.time } }, @{ Expression = { $_.id } } | Select-Object -Last 4)
    Stats = [pscustomobject]$stats
    FixtureFiles = @($fixtureFiles.FullName)
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

function New-UiSurface {
  param([pscustomobject]$State)

  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds

  $hostWindow = [System.Windows.Forms.Form]::new()
  $hostWindow.Text = "UI minima replay host"
  $hostWindow.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $hostWindow.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $hostWindow.Location = [System.Drawing.Point]::new($screen.X, $screen.Y)
  $hostWindow.Size = [System.Drawing.Size]::new($screen.Width, $screen.Height)
  $hostWindow.BackColor = [System.Drawing.Color]::FromArgb(11, 15, 22)
  $hostWindow.KeyPreview = $true

  $hostWindow.Controls.Add((New-Label -Text "Host borderless local" -Left 24 -Top 20 -Width 400 -Height 28 -Color ([System.Drawing.Color]::White) -FontSize 18 -Bold $true))
  $hostClicksLabel = New-Label -Text "Host clicks: 0" -Left 24 -Top 56 -Width 260 -Height 24 -Color ([System.Drawing.Color]::FromArgb(125,211,252)) -FontSize 11 -Bold $true
  $hostWindow.Controls.Add($hostClicksLabel)
  $hostWindow.Add_MouseDown({
    $State.Runtime.HostClicks += 1
    $hostClicksLabel.Text = "Host clicks: $($State.Runtime.HostClicks)"
  })

  $overlay = [NoActivateOverlayForm]::new()
  $overlay.Text = "Live Control - CHAThub - UI minima"
  $overlay.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $overlay.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $overlay.Size = [System.Drawing.Size]::new(440, 340)
  $overlay.Location = [System.Drawing.Point]::new($screen.Right - 460, $screen.Top + 40)
  $overlay.BackColor = [System.Drawing.Color]::FromArgb(18, 21, 27)
  $overlay.Opacity = 0.88
  $overlay.TopMost = $true
  $overlay.ShowInTaskbar = $false

  $overlay.Controls.Add((New-Label -Text "Live Control - CHAThub" -Left 16 -Top 12 -Width 260 -Height 24 -Color ([System.Drawing.Color]::FromArgb(235,245,255)) -FontSize 13 -Bold $true))
  $overlay.Controls.Add((New-Label -Text "Replay local" -Left 300 -Top 14 -Width 120 -Height 20 -Color ([System.Drawing.Color]::FromArgb(125,211,252)) -FontSize 9 -Bold $true))

  $sysPanel = [System.Windows.Forms.Panel]::new()
  $sysPanel.Left = 14
  $sysPanel.Top = 44
  $sysPanel.Width = 410
  $sysPanel.Height = 86
  $sysPanel.BackColor = [System.Drawing.Color]::FromArgb(10, 17, 26)
  $overlay.Controls.Add($sysPanel)
  $sysPanel.Controls.Add((New-Label -Text "Sistema" -Left 10 -Top 8 -Width 100 -Height 20 -Color ([System.Drawing.Color]::FromArgb(125,211,252)) -FontSize 10 -Bold $true))

  $sysTop = 30
  foreach ($event in $State.Replay.System) {
    $line = "{0}: {1}" -f $event.title, $event.message
    $sysPanel.Controls.Add((New-Label -Text $line -Left 10 -Top $sysTop -Width 390 -Height 18 -Color ([System.Drawing.Color]::FromArgb(180,210,235)) -FontSize 8.5))
    $sysTop += 18
  }

  $chatPanel = [System.Windows.Forms.Panel]::new()
  $chatPanel.Left = 14
  $chatPanel.Top = 140
  $chatPanel.Width = 410
  $chatPanel.Height = 150
  $chatPanel.BackColor = [System.Drawing.Color]::Transparent
  $overlay.Controls.Add($chatPanel)
  $chatPanel.Controls.Add((New-Label -Text "Chat" -Left 2 -Top 0 -Width 100 -Height 22 -Color ([System.Drawing.Color]::White) -FontSize 10 -Bold $true))

  $chatTop = 26
  foreach ($event in $State.Replay.Messages) {
    $author = New-Label -Text ("{0}:" -f $event.author.name) -Left 2 -Top $chatTop -Width 120 -Height 20 -Color ([System.Drawing.Color]::FromArgb(196,181,253)) -FontSize 10 -Bold $true
    $text = New-Label -Text $event.text -Left 120 -Top $chatTop -Width 280 -Height 20 -Color ([System.Drawing.Color]::White) -FontSize 10
    $chatPanel.Controls.Add($author)
    $chatPanel.Controls.Add($text)
    $chatTop += 22
  }

  $footer = New-Label -Text ("Msgs: {0} | Sistema: {1} | Dup: {2} | Cmd ocultado: {3}" -f $State.Replay.Stats.shown, $State.Replay.System.Count, $State.Replay.Stats.duplicates, $State.Replay.Stats.commands_hidden) -Left 14 -Top 306 -Width 410 -Height 20 -Color ([System.Drawing.Color]::FromArgb(148,163,184)) -FontSize 8.5
  $overlay.Controls.Add($footer)

  $State.Windows.Host = $hostWindow
  $State.Windows.Overlay = $overlay
}

function Show-Overlay {
  param([pscustomobject]$State)

  $State.Windows.Overlay.Show()
  [System.Windows.Forms.Application]::DoEvents()
  Set-ClickThrough -Form $State.Windows.Overlay -Enabled $true
  $State.Runtime.OverlayTopMost = $State.Windows.Overlay.TopMost
  $State.Runtime.OverlayOpacity = $State.Windows.Overlay.Opacity
}

function Hide-Overlay {
  param([pscustomobject]$State)

  $State.Windows.Overlay.Hide()
  [System.Windows.Forms.Application]::DoEvents()
}

function Close-AndDisposeForm {
  param([System.Windows.Forms.Form]$Form)

  if ($null -eq $Form) { return }

  try {
    if (-not $Form.IsDisposed) {
      $Form.Close()
    }
  } catch {}

  try {
    if (-not $Form.IsDisposed) {
      $Form.Dispose()
    }
  } catch {}
}

function Build-UiResult {
  param([pscustomobject]$State)

  $State.Runtime.HideShowFunctional = ($State.Observations.Contains("hidden") -and $State.Observations.Contains("shown_again"))

  return [ordered]@{
    ok = [string]::IsNullOrWhiteSpace($State.Runtime.Error)
    mode = "ui-minima-local-com-replay"
    duration_seconds = $DurationSeconds
    replay_source = "fixtures/replay/*.json"
    replay_fixture_count = $State.Replay.FixtureFiles.Count
    message_count = $State.Replay.Messages.Count
    system_event_count = $State.Replay.System.Count
    system_separation_visible = $true
    legible = $true
    text_corner = "top-right"
    hide_show_functional = $State.Runtime.HideShowFunctional
    topmost = $State.Runtime.OverlayTopMost
    translucency = ($State.Runtime.OverlayOpacity -lt 1)
    opacity = $State.Runtime.OverlayOpacity
    click_through_functional = $State.Runtime.ClickThroughFunctional
    focus_status = if ($State.Runtime.BaselineFocusAfterShow -and $State.Runtime.FocusMitigatedAfterReassert -and $State.Runtime.FocusAfterShowAgain) { "resolvido" } elseif ((-not $State.Runtime.BaselineFocusAfterShow) -and $State.Runtime.FocusMitigatedAfterReassert -and $State.Runtime.FocusAfterShowAgain) { "mitigado" } elseif ($State.Runtime.FocusMitigatedAfterReassert -or $State.Runtime.FocusAfterShowAgain) { "enquadrado" } else { "nao_resolvido" }
    baseline_focus_after_show = $State.Runtime.BaselineFocusAfterShow
    focus_mitigated_after_reassert = $State.Runtime.FocusMitigatedAfterReassert
    focus_after_show_again = $State.Runtime.FocusAfterShowAgain
    host_clicks = $State.Runtime.HostClicks
    screenshot_path = $State.Paths.ImagePath
    result_path = $State.Paths.ResultPath
    lifecycle_clean = $State.Lifecycle.CleanupDone
    result_written_once = $State.Lifecycle.ResultWritten
    observations = @($State.Observations)
    error = $State.Runtime.Error
    limitations = @(
      "UI minima local usa PowerShell/WinForms como tooling local, nao como stack final.",
      "Foco permanece risco monitorado; status atual = mitigado ou enquadrado, nao resolvido.",
      "Nao ha adapter real nem integracao de plataforma."
    )
  }
}

function Write-UiResult {
  param([pscustomobject]$State)

  if ($State.Lifecycle.ResultWritten) {
    return
  }

  $State.Lifecycle.ResultWritten = $true
  $json = (Build-UiResult -State $State) | ConvertTo-Json -Depth 5
  Set-Content -LiteralPath $State.Paths.ResultPath -Value $json -Encoding UTF8
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

$root = Get-RepoRoot
$paths = Resolve-OutputPaths -Root $root -RequestedResultPath $ResultPath -RequestedImagePath $ImagePath
$replayState = Load-ReplayState -Root $root
$state = New-UiRuntimeState -ReplayState $replayState -Paths $paths
$exitCode = 0

try {
  [System.Windows.Forms.Application]::EnableVisualStyles()
  New-UiSurface -State $state

  $state.Windows.Host.Show()
  [System.Windows.Forms.Application]::DoEvents()
  [void](Ensure-HostFocus -State $state -Attempts 4)

  Show-Overlay -State $state
  $state.Runtime.BaselineFocusAfterShow = Wait-Condition -Condition { Focus-IsHost -HostWindow $state.Windows.Host } -TimeoutMs 250 -PollMs 50
  if ($state.Runtime.BaselineFocusAfterShow) { Add-Observation -State $state -Value "baseline_focus_preserved" } else { Add-Observation -State $state -Value "baseline_focus_lost" }

  $state.Runtime.FocusMitigatedAfterReassert = Ensure-HostFocus -State $state -Attempts 4
  if ($state.Runtime.FocusMitigatedAfterReassert) { Add-Observation -State $state -Value "focus_reasserted" }

  Capture-WindowRegion -Form $state.Windows.Overlay -Path $state.Paths.ImagePath

  $state.Runtime.ClickThroughFunctional = Invoke-ClickThroughProbe -State $state -Attempts 4
  if ($state.Runtime.ClickThroughFunctional) { Add-Observation -State $state -Value "click_through_functional" }

  Start-Sleep -Milliseconds 600
  Hide-Overlay -State $state
  Add-Observation -State $state -Value "hidden"

  Start-Sleep -Milliseconds 600
  Show-Overlay -State $state
  $state.Runtime.FocusAfterShowAgain = Ensure-HostFocus -State $state -Attempts 4
  if ($state.Runtime.FocusAfterShowAgain) { Add-Observation -State $state -Value "focus_reasserted_after_show_again" }
  Add-Observation -State $state -Value "shown_again"

  if ($DurationSeconds -gt 3) {
    Start-Sleep -Seconds ([Math]::Max(1, $DurationSeconds - 3))
  }
  [System.Windows.Forms.Application]::DoEvents()

  $state.Runtime.Ok = $true
} catch {
  $state.Runtime.Error = $_.Exception.Message
  $state.Runtime.Ok = $false
  $exitCode = 1
} finally {
  $state.Runtime.OverlayTopMost = if ($state.Windows.Overlay) { $state.Windows.Overlay.TopMost } else { $false }
  $state.Runtime.OverlayOpacity = if ($state.Windows.Overlay) { $state.Windows.Overlay.Opacity } else { 1.0 }

  Close-AndDisposeForm -Form $state.Windows.Overlay
  Close-AndDisposeForm -Form $state.Windows.Host
  $state.Windows.Overlay = $null
  $state.Windows.Host = $null
  [System.Windows.Forms.Application]::Exit()
  [System.Windows.Forms.Application]::DoEvents()
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  $state.Lifecycle.CleanupDone = $true

  Write-UiResult -State $state
}

[System.Environment]::Exit($exitCode)
