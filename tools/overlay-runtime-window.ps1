#        __     __                   
# _|_   (_ ||\/|__) /\ _ _ _ _|   _  
#  |    __)||  |__)/--|_| (_(_||_|/_ 
#                     |  

param(
  [string]$RuntimeUrl = "http://localhost:4310",
  [int]$PollMs = 700,
  [int]$Width = 320,
  [int]$Height = 360,
  [string]$DisplayId = "primary",
  [int]$OffsetX = 32,
  [int]$OffsetY = 96,
  [ValidateSet("top-left", "top-right", "bottom-left", "bottom-right")]
  [string]$Position = "top-right",
  [int]$DurationMs = 18000,
  [int]$MaxMessages = 6,
  [int]$FontSizePx = 18,
  [ValidateSet("regular", "semibold", "bold")]
  [string]$MessageFontWeight = "semibold",
  [double]$LineHeight = 1.25,
  [int]$GapPx = 6,
  [int]$BackgroundOpacity = 18,
  [int]$ShowPlatformBadge = 1,
  [int]$ShowChannel = 1,
  [int]$ShowAvatar = 0,
  [ValidateSet("fade", "none")]
  [string]$Animation = "fade",
  [int]$FilterMessages = 1,
  [int]$FilterJoins = 0,
  [int]$FilterAudienceUpdates = 0,
  [int]$FilterTechnicalEvents = 0,
  [string]$PlatformsJson = "{}",
  [switch]$Interactive
)

$ErrorActionPreference = "Stop"

$runtimeDirOverride = [Environment]::GetEnvironmentVariable("CHAT_HUB_RUNTIME_DIR")
$script:OverlayRuntimeDir = if (-not [string]::IsNullOrWhiteSpace($runtimeDirOverride)) {
  $runtimeDirOverride
} else {
  Join-Path $PSScriptRoot "..\runtime"
}
try {
  New-Item -ItemType Directory -Force -Path $script:OverlayRuntimeDir | Out-Null
} catch {}
$script:OverlayLogPath = Join-Path $script:OverlayRuntimeDir "overlay-debug.log"
$script:OverlayFontFamily = "Segoe UI Emoji"

function Write-OverlayLog {
  param([string]$Message)
  $ts = Get-Date -Format "HH:mm:ss.fff"
  $line = "[$ts] $Message"
  try { Add-Content -Path $script:OverlayLogPath -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue } catch {}
  Write-Host $line
}

Write-OverlayLog "=== overlay-runtime-window.ps1 iniciando ==="
Write-OverlayLog "RuntimeUrl=[$RuntimeUrl] DisplayId=[$DisplayId] Position=[$Position] Width=[$Width] Height=[$Height] MessageFontWeight=[$MessageFontWeight]"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ("LiveChatOverlayRuntimeNative" -as [type])) {
  Add-Type -ReferencedAssemblies @("System.Windows.Forms", "System.Drawing") @"
using System;
using System.ComponentModel;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class LiveChatOverlayRuntimeNative {
  public const int GWL_EXSTYLE = -20;
  public const int WS_EX_TRANSPARENT = 0x00000020;
  public const int WS_EX_LAYERED = 0x00080000;
  public const int WS_EX_TOOLWINDOW = 0x00000080;
  public const int WS_EX_NOACTIVATE = 0x08000000;
  public const int ULW_ALPHA = 0x00000002;
  public const byte AC_SRC_OVER = 0x00;
  public const byte AC_SRC_ALPHA = 0x01;

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;

    public POINT(int x, int y) {
      X = x;
      Y = y;
    }
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct SIZE {
    public int CX;
    public int CY;

    public SIZE(int cx, int cy) {
      CX = cx;
      CY = cy;
    }
  }

  [StructLayout(LayoutKind.Sequential, Pack = 1)]
  public struct BLENDFUNCTION {
    public byte BlendOp;
    public byte BlendFlags;
    public byte SourceConstantAlpha;
    public byte AlphaFormat;
  }

  [DllImport("user32.dll", EntryPoint="GetWindowLong")]
  private static extern int GetWindowLong32(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", EntryPoint="SetWindowLong")]
  private static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);

  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")]
  private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")]
  private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

  [DllImport("gdi32.dll")]
  public static extern IntPtr CreateRoundRectRgn(int nLeftRect, int nTopRect, int nRightRect, int nBottomRect, int nWidthEllipse, int nHeightEllipse);

  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr GetDC(IntPtr hWnd);

  [DllImport("user32.dll", SetLastError=true)]
  public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

  [DllImport("gdi32.dll", SetLastError=true)]
  public static extern IntPtr CreateCompatibleDC(IntPtr hDC);

  [DllImport("gdi32.dll", SetLastError=true)]
  public static extern bool DeleteDC(IntPtr hDC);

  [DllImport("gdi32.dll", SetLastError=true)]
  public static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);

  [DllImport("gdi32.dll", SetLastError=true)]
  public static extern bool DeleteObject(IntPtr hObject);

  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool UpdateLayeredWindow(
    IntPtr hWnd,
    IntPtr hdcDst,
    ref POINT pptDst,
    ref SIZE psize,
    IntPtr hdcSrc,
    ref POINT pptSrc,
    int crKey,
    ref BLENDFUNCTION pblend,
    int dwFlags
  );

  public static IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, nIndex) : new IntPtr(GetWindowLong32(hWnd, nIndex));
  }

  public static IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong) {
    return IntPtr.Size == 8 ? SetWindowLongPtr64(hWnd, nIndex, dwNewLong) : new IntPtr(SetWindowLong32(hWnd, nIndex, dwNewLong.ToInt32()));
  }

  public static void UpdateLayeredWindowBitmap(Form form, Bitmap bitmap) {
    IntPtr screenDc = GetDC(IntPtr.Zero);
    if (screenDc == IntPtr.Zero) {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    IntPtr memDc = IntPtr.Zero;
    IntPtr hBitmap = IntPtr.Zero;
    IntPtr oldBitmap = IntPtr.Zero;

    try {
      memDc = CreateCompatibleDC(screenDc);
      if (memDc == IntPtr.Zero) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }

      hBitmap = bitmap.GetHbitmap(Color.FromArgb(0));
      oldBitmap = SelectObject(memDc, hBitmap);

      POINT source = new POINT(0, 0);
      POINT destination = new POINT(form.Left, form.Top);
      SIZE size = new SIZE(bitmap.Width, bitmap.Height);
      BLENDFUNCTION blend = new BLENDFUNCTION {
        BlendOp = AC_SRC_OVER,
        BlendFlags = 0,
        SourceConstantAlpha = 255,
        AlphaFormat = AC_SRC_ALPHA
      };

      if (!UpdateLayeredWindow(form.Handle, screenDc, ref destination, ref size, memDc, ref source, 0, ref blend, ULW_ALPHA)) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
    } finally {
      if (oldBitmap != IntPtr.Zero) {
        SelectObject(memDc, oldBitmap);
      }
      if (hBitmap != IntPtr.Zero) {
        DeleteObject(hBitmap);
      }
      if (memDc != IntPtr.Zero) {
        DeleteDC(memDc);
      }
      ReleaseDC(IntPtr.Zero, screenDc);
    }
  }
}

public class LiveChatNoActivateOverlayForm : Form {
  protected override bool ShowWithoutActivation {
    get { return true; }
  }

  protected override CreateParams CreateParams {
    get {
      CreateParams cp = base.CreateParams;
      cp.ExStyle |= LiveChatOverlayRuntimeNative.WS_EX_NOACTIVATE;
      cp.ExStyle |= LiveChatOverlayRuntimeNative.WS_EX_TOOLWINDOW;
      return cp;
    }
  }
}

public class LiveChatMessageChipControl : Control {
  public string MessageText { get; set; }
  public string AuthorText { get; set; }
  public string BodyText { get; set; }
  public System.Drawing.Color AccentColor { get; set; }
  public System.Drawing.Color TextColor { get; set; }
  public int BackgroundAlpha { get; set; }
  public int Radius { get; set; }
  public int AccentWidth { get; set; }
  public int HorizontalPadding { get; set; }
  public int VerticalPadding { get; set; }
  public float FontSizePx { get; set; }

  public LiveChatMessageChipControl() {
    MessageText = "";
    AuthorText = "";
    BodyText = "";
    AccentColor = System.Drawing.Color.White;
    TextColor = System.Drawing.Color.FromArgb(246, 250, 255);
    BackgroundAlpha = 44;
    Radius = 18;
    AccentWidth = 5;
    HorizontalPadding = 14;
    VerticalPadding = 7;
    FontSizePx = 10f;
    this.SetStyle(ControlStyles.UserPaint, true);
    this.SetStyle(ControlStyles.AllPaintingInWmPaint, true);
    this.SetStyle(ControlStyles.OptimizedDoubleBuffer, true);
    this.SetStyle(ControlStyles.SupportsTransparentBackColor, true);
    this.BackColor = System.Drawing.Color.Transparent;
  }

  protected override void OnPaint(PaintEventArgs e) {
    base.OnPaint(e);
    e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
    e.Graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

    var rect = new System.Drawing.Rectangle(0, 0, this.Width - 1, this.Height - 1);
    using (var path = RoundedRect(rect, Radius)) {
      using (var brush = new System.Drawing.SolidBrush(System.Drawing.Color.FromArgb(BackgroundAlpha, 8, 11, 16))) {
        e.Graphics.FillPath(brush, path);
      }
      using (var borderPen = new System.Drawing.Pen(System.Drawing.Color.FromArgb(42, 255, 255, 255), 1)) {
        e.Graphics.DrawPath(borderPen, path);
      }

      var oldClip = e.Graphics.Clip;
      e.Graphics.SetClip(path);
      using (var accentBrush = new System.Drawing.SolidBrush(AccentColor)) {
        e.Graphics.FillRectangle(accentBrush, 0, 0, AccentWidth, this.Height);
      }
      e.Graphics.Clip = oldClip;
    }

    using (var font = new System.Drawing.Font("Segoe UI", FontSizePx, System.Drawing.FontStyle.Bold)) {
      var textRect = new System.Drawing.Rectangle(HorizontalPadding, VerticalPadding, this.Width - HorizontalPadding - 8, this.Height - (VerticalPadding * 2));
      var text = (AuthorText ?? "") + ": " + (BodyText ?? "");
      var authorPrefix = (AuthorText ?? "") + ": ";
      var shadowRect = new System.Drawing.Rectangle(textRect.X + 1, textRect.Y + 1, textRect.Width, textRect.Height);

      TextRenderer.DrawText(e.Graphics, text, font, shadowRect, System.Drawing.Color.FromArgb(200, 0, 0, 0), TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);
      TextRenderer.DrawText(e.Graphics, text, font, textRect, TextColor, TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);

      var prefixSize = TextRenderer.MeasureText(e.Graphics, authorPrefix, font, new System.Drawing.Size(textRect.Width, textRect.Height), TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
      var authorRect = new System.Drawing.Rectangle(textRect.X, textRect.Y, Math.Min(prefixSize.Width, textRect.Width), Math.Min(prefixSize.Height, textRect.Height));
      var authorShadowRect = new System.Drawing.Rectangle(authorRect.X + 1, authorRect.Y + 1, authorRect.Width, authorRect.Height);

      TextRenderer.DrawText(e.Graphics, authorPrefix, font, authorShadowRect, System.Drawing.Color.FromArgb(215, 0, 0, 0), TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
      TextRenderer.DrawText(e.Graphics, authorPrefix, font, authorRect, AccentColor, TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
    }
  }

  private static System.Drawing.Drawing2D.GraphicsPath RoundedRect(System.Drawing.Rectangle bounds, int radius) {
    int diameter = radius * 2;
    var path = new System.Drawing.Drawing2D.GraphicsPath();
    path.AddArc(bounds.X, bounds.Y, diameter, diameter, 180, 90);
    path.AddArc(bounds.Right - diameter, bounds.Y, diameter, diameter, 270, 90);
    path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
    path.AddArc(bounds.X, bounds.Bottom - diameter, diameter, diameter, 90, 90);
    path.CloseFigure();
    return path;
  }
}
"@
}

Write-OverlayLog "Add-Type compilado com sucesso. Criando form..."

function Set-ClickThrough {
  param(
    [System.Windows.Forms.Form]$Form,
    [bool]$Enabled
  )

  $current = [LiveChatOverlayRuntimeNative]::GetWindowLongPtr($Form.Handle, [LiveChatOverlayRuntimeNative]::GWL_EXSTYLE).ToInt64()
  $base = $current -bor [LiveChatOverlayRuntimeNative]::WS_EX_LAYERED -bor [LiveChatOverlayRuntimeNative]::WS_EX_TOOLWINDOW -bor [LiveChatOverlayRuntimeNative]::WS_EX_NOACTIVATE

  $next = if ($Enabled) {
    $base -bor [LiveChatOverlayRuntimeNative]::WS_EX_TRANSPARENT
  } else {
    $base -band (-bnot [LiveChatOverlayRuntimeNative]::WS_EX_TRANSPARENT)
  }

  [void][LiveChatOverlayRuntimeNative]::SetWindowLongPtr($Form.Handle, [LiveChatOverlayRuntimeNative]::GWL_EXSTYLE, [IntPtr]$next)
}

function Convert-HexColor {
  param(
    [string]$Hex,
    [System.Drawing.Color]$Fallback
  )

  if ([string]::IsNullOrWhiteSpace($Hex)) {
    return $Fallback
  }

  try {
    return [System.Drawing.ColorTranslator]::FromHtml($Hex)
  } catch {
    return $Fallback
  }
}

function Convert-OpacityPercentToAlpha {
  param(
    [int]$Percent
  )

  return [Math]::Round(255 * ([Math]::Min(100, [Math]::Max(0, $Percent)) / 100))
}

function New-OverlayMessageBackgroundBrush {
  param(
    [System.Drawing.Rectangle]$Bounds,
    [int]$OpacityPercent
  )

  $alpha = [int](Convert-OpacityPercentToAlpha -Percent $OpacityPercent)
  $startAlpha = [int][Math]::Min(255, [Math]::Round($alpha * 1.10))
  $endAlpha = [int][Math]::Min(255, [Math]::Round($alpha * 0.74))
  $startColor = [System.Drawing.Color]::FromArgb($startAlpha, 12, 16, 26)
  $endColor = [System.Drawing.Color]::FromArgb($endAlpha, 5, 8, 15)

  return [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $Bounds,
    $startColor,
    $endColor,
    [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal
  )
}

function New-OverlayMessageSheenBrush {
  param(
    [System.Drawing.Rectangle]$Bounds,
    [int]$OpacityPercent
  )

  $alpha = [int](Convert-OpacityPercentToAlpha -Percent $OpacityPercent)
  $startAlpha = [int][Math]::Min(20, [Math]::Round($alpha * 0.07))
  $endAlpha = [int][Math]::Min(7, [Math]::Round($alpha * 0.02))

  if ($startAlpha -le 0 -and $endAlpha -le 0) {
    return $null
  }

  return [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $Bounds,
    [System.Drawing.Color]::FromArgb($startAlpha, 255, 255, 255),
    [System.Drawing.Color]::FromArgb($endAlpha, 255, 255, 255),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
  )
}

function Resolve-OverlayMessageBorderAlpha {
  param(
    [int]$OpacityPercent
  )

  $alpha = [int](Convert-OpacityPercentToAlpha -Percent $OpacityPercent)
  if ($alpha -le 0) {
    return 0
  }

  return [int][Math]::Min(34, [Math]::Max(8, [Math]::Round($alpha * 0.16)))
}

function Resolve-MessageFontStyle {
  param(
    [string]$Weight
  )

  if ($Weight -eq "regular") {
    return [System.Drawing.FontStyle]::Regular
  }

  # WinForms/GDI does not expose a dedicated semibold style reliably.
  # Keep the config surface stable now and map semibold to bold in the real overlay.
  return [System.Drawing.FontStyle]::Bold
}

function Format-OverlayAuthorText {
  param(
    [string]$Text
  )

  if ([string]::IsNullOrWhiteSpace($Text)) {
    return "AUTOR"
  }

  return $Text.ToUpperInvariant()
}

function Get-OverlayInitials {
  param(
    [string]$Text
  )

  $safeText = Format-OverlayAuthorText -Text $Text
  $chars = @($safeText.Trim().ToCharArray())
  if ($chars.Count -eq 0) {
    return "?"
  }

  return -join ($chars | Select-Object -First 2)
}

function Convert-ToOverlayBool {
  param(
    [object]$Value
  )

  if ($Value -is [bool]) {
    return $Value
  }

  if ($null -eq $Value) {
    return $false
  }

  $text = [string]$Value
  return $text -eq "1" -or $text.Equals("true", [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-SelectedScreen {
  param(
    [string]$TargetDisplayId
  )

  $screens = [System.Windows.Forms.Screen]::AllScreens
  if (-not $TargetDisplayId -or $TargetDisplayId -eq "primary") {
    return $screens | Where-Object Primary | Select-Object -First 1
  }

  $match = $screens | Where-Object { $_.DeviceName -eq $TargetDisplayId } | Select-Object -First 1
  if ($match) {
    return $match
  }

  return $screens | Where-Object Primary | Select-Object -First 1
}

function Get-OverlayPlatforms {
  param(
    [string]$Json
  )

  try {
    $parsed = ConvertFrom-Json -InputObject $Json -AsHashtable
    if ($parsed) {
      return $parsed
    }
  } catch {
    # ignore
  }

  return @{
    twitch = $true
    youtube = $true
    kick = $true
    tiktok = $true
  }
}

function Get-CanonicalChannelLabel {
  param(
    [string]$Source,
    $Item,
    $Snapshot
  )

  $provider = $Snapshot.settings.providers.$Source
  if ($Source -eq "tiktok") {
    $handle = $provider.unique_id
    if (-not $handle) { $handle = $provider.channel }
    if (-not $handle) { $handle = $Item.channel }
    if (-not $handle) { return "" }
    return "@$($handle -replace '^@', '')"
  }

  if ($Source -eq "youtube") {
    if ($provider.channel) { return $provider.channel }
    if ($provider.channel_id) { return $provider.channel_id }
  }

  if ($provider.channel) {
    return $provider.channel
  }

  if ($Item.channel_display_name) {
    return $Item.channel_display_name
  }

  return [string]$Item.channel
}

function Convert-KickEmoteShortcodesToText {
  param(
    [string]$Text,
    [bool]$IncludeEmoteText = $true
  )

  if ([string]::IsNullOrEmpty($Text)) {
    return ""
  }

  $pattern = '\[emote:(\d+):([^\]\r\n]+)\]|\[emotes?(\d+)\]'
  return [regex]::Replace($Text, $pattern, {
    param($match)

    if (-not $IncludeEmoteText) {
      return ""
    }

    $id = ""
    if ($match.Groups[1].Success -and $match.Groups[1].Value) {
      $id = [string]$match.Groups[1].Value
    } elseif ($match.Groups[3].Success -and $match.Groups[3].Value) {
      $id = [string]$match.Groups[3].Value
    }

    $label = ""
    if ($match.Groups[2].Success -and $match.Groups[2].Value) {
      $label = [string]$match.Groups[2].Value
    } elseif ($id) {
      $label = "emote $id"
    } else {
      $label = "emote"
    }

    return ($label -replace '^:+|:+$', '').Trim()
  })
}

function Convert-TikTokEmoteShortcodesToText {
  param(
    [string]$Text,
    [bool]$IncludeEmoteText = $true
  )

  if ([string]::IsNullOrEmpty($Text)) {
    return ""
  }

  $pattern = '\[([A-Za-z][A-Za-z0-9_-]{1,48})\]'
  return [regex]::Replace($Text, $pattern, {
    param($match)

    if (-not $IncludeEmoteText) {
      return ""
    }

    return [string]$match.Groups[1].Value
  })
}

function Convert-EmoteShortcodesToText {
  param(
    [string]$Text,
    [bool]$IncludeEmoteText = $true
  )

  $withoutKick = Convert-KickEmoteShortcodesToText -Text $Text -IncludeEmoteText $IncludeEmoteText
  return Convert-TikTokEmoteShortcodesToText -Text $withoutKick -IncludeEmoteText $IncludeEmoteText
}

function Get-KickShortcodeEmoteParts {
  param(
    [string]$Text
  )

  $emotes = New-Object System.Collections.Generic.List[object]
  if ([string]::IsNullOrEmpty($Text)) {
    return @($emotes.ToArray())
  }

  $pattern = '\[emote:(\d+):([^\]\r\n]+)\]|\[emotes?(\d+)\]'
  foreach ($match in [regex]::Matches($Text, $pattern)) {
    $id = ""
    if ($match.Groups[1].Success -and $match.Groups[1].Value) {
      $id = [string]$match.Groups[1].Value
    } elseif ($match.Groups[3].Success -and $match.Groups[3].Value) {
      $id = [string]$match.Groups[3].Value
    }

    if ($id -notmatch '^\d+$') {
      continue
    }

    $label = ""
    if ($match.Groups[2].Success -and $match.Groups[2].Value) {
      $label = ([string]$match.Groups[2].Value -replace '^:+|:+$', '').Trim()
    }
    if (-not $label) {
      $label = "emote $id"
    }

    $emotes.Add([PSCustomObject]@{
      Src = "https://files.kick.com/emotes/$id/fullsize"
      Alt = $label
    }) | Out-Null
  }

  return @($emotes.ToArray())
}

function Convert-MessagePartsToText {
  param(
    $Message,
    [bool]$IncludeEmoteText = $true
  )

  if ($Message.parts) {
    $segments = New-Object System.Collections.Generic.List[string]
    foreach ($part in @($Message.parts)) {
      $value = if ($part.type -eq "emote") {
        if (-not $IncludeEmoteText) {
          ""
        } elseif ($part.alt) {
          [string]$part.alt
        } elseif ($part.value) {
          [string]$part.value
        } else {
          ""
        }
      } else {
        [string]$part.value
      }

      $value = Convert-EmoteShortcodesToText -Text $value -IncludeEmoteText $IncludeEmoteText
      if (-not [string]::IsNullOrEmpty($value)) {
        $segments.Add($value) | Out-Null
      }
    }

    $joined = -join $segments.ToArray()
    if (-not [string]::IsNullOrWhiteSpace($joined)) {
      return $joined
    }
  }

  return Convert-EmoteShortcodesToText -Text ([string]$Message.text) -IncludeEmoteText $IncludeEmoteText
}

function Get-OverlayEmoteParts {
  param(
    $Message
  )

  $emotes = New-Object System.Collections.Generic.List[object]
  $seen = @{}
  foreach ($part in @($Message.parts)) {
    if ($part.type -ne "emote" -or [string]::IsNullOrWhiteSpace([string]$part.src)) {
      continue
    }

    $seen[[string]$part.src] = $true
    $emotes.Add([PSCustomObject]@{
      Src = [string]$part.src
      Alt = if ($part.alt) { [string]$part.alt } elseif ($part.value) { [string]$part.value } else { "emote" }
    }) | Out-Null
  }

  if ($emotes.Count -gt 0) {
    return @($emotes.ToArray())
  }

  $textSegments = New-Object System.Collections.Generic.List[string]
  foreach ($part in @($Message.parts)) {
    if ($part.type -eq "text" -and -not [string]::IsNullOrEmpty([string]$part.value)) {
      $textSegments.Add([string]$part.value) | Out-Null
    }
  }
  if (-not [string]::IsNullOrEmpty([string]$Message.text)) {
    $textSegments.Add([string]$Message.text) | Out-Null
  }

  foreach ($segment in @($textSegments.ToArray())) {
    foreach ($emote in @(Get-KickShortcodeEmoteParts -Text $segment)) {
      if ($seen[[string]$emote.Src]) {
        continue
      }

      $seen[[string]$emote.Src] = $true
      $emotes.Add($emote) | Out-Null
    }
  }

  return @($emotes.ToArray())
}

function Get-OverlayItems {
  param(
    $Snapshot,
    [datetime]$CutoffUtc,
    [hashtable]$AllowedPlatforms
  )

  $items = New-Object System.Collections.Generic.List[object]

  if ($filterMessagesEnabled -or $filterJoinsEnabled) {
    foreach ($message in @($Snapshot.state.messages)) {
      try {
        if (([DateTime]$message.time).ToUniversalTime() -lt $CutoffUtc) {
          continue
        }
      } catch {
        # ignore parse error and keep item
      }

      if (-not $AllowedPlatforms[[string]$message.source]) {
        continue
      }

      $kind = [string]$message.kind
      $isJoin = $kind -eq "membership"
      if ($isJoin -and -not $filterJoinsEnabled) {
        continue
      }
      if (-not $isJoin -and -not $filterMessagesEnabled) {
        continue
      }

      $emoteParts = Get-OverlayEmoteParts -Message $message
      $items.Add([PSCustomObject]@{
        time = $message.time
        source = [string]$message.source
        platform_label = [string]$message.platform_label
        author = [string]$message.author.name
        body = Convert-MessagePartsToText -Message $message -IncludeEmoteText (@($emoteParts).Count -eq 0)
        emotes = @($emoteParts)
        channel = Get-CanonicalChannelLabel -Source ([string]$message.source) -Item $message -Snapshot $Snapshot
        accent_color = [string]$message.accent_color
      }) | Out-Null
    }
  }

  foreach ($event in @($Snapshot.state.system_events)) {
    try {
      if (([DateTime]$event.time).ToUniversalTime() -lt $CutoffUtc) {
        continue
      }
    } catch {
      # ignore parse error and keep item
    }

    if (-not $AllowedPlatforms[[string]$event.source]) {
      continue
    }

    $isAudienceUpdate = ($event.kind -eq "livestream_metadata_updated" -and $null -ne $event.metadata.viewer_count)
    if ($isAudienceUpdate -and -not $filterAudienceEnabled) {
      continue
    }

    if (-not $isAudienceUpdate -and -not $filterTechnicalEnabled) {
      continue
    }

    $items.Add([PSCustomObject]@{
      time = $event.time
      source = [string]$event.source
      platform_label = [string]$event.platform_label
      author = if ($isAudienceUpdate) { "Atualizacao" } else { [string]$event.platform_label }
      body = [string]$event.message
      channel = Get-CanonicalChannelLabel -Source ([string]$event.source) -Item $event -Snapshot $Snapshot
      accent_color = [string]$event.accent_color
    }) | Out-Null
  }

  return $items | Sort-Object {
    try { [DateTime]$_.time } catch { [datetime]::MinValue }
  } -Descending
}

function New-LineLabel {
  param(
    [int]$Left = 18,
    [int]$Top,
    [int]$Height = 34,
    [int]$FontSize = 10,
    [System.Drawing.Color]$Color = [System.Drawing.Color]::White
  )

  $label = [System.Windows.Forms.Label]::new()
  $label.AutoSize = $false
  $label.Left = $Left
  $label.Top = $Top
  $label.Width = $Width - 24
  $label.Height = $Height
  $label.BackColor = [System.Drawing.Color]::Transparent
  $label.ForeColor = $Color
  $label.Font = [System.Drawing.Font]::new("Segoe UI", $FontSize, [System.Drawing.FontStyle]::Bold)
  $label.AutoEllipsis = $false
  return $label
}

function New-MessageChip {
  param(
    [int]$Top
  )

  $chip = [LiveChatMessageChipControl]::new()
  $chip.Left = 8
  $chip.Top = $Top
  $chip.Width = $Width - 16
  $chip.Height = 42
  $chip.FontSizePx = $FontSizePx
  $chip.BackgroundAlpha = Convert-OpacityPercentToAlpha -Percent $BackgroundOpacity
  return $chip
}

function Measure-TextBlockHeight {
  param(
    [string]$Text,
    [int]$LabelWidth,
    [System.Drawing.Font]$Font,
    [switch]$SingleLine
  )

  $safeText = if ([string]::IsNullOrWhiteSpace($Text)) { " " } else { $Text }
  $proposed = [System.Drawing.Size]::new([Math]::Max(1, $LabelWidth), 2000)
  $flags = [System.Windows.Forms.TextFormatFlags]::NoPadding
  if ($SingleLine) {
    $flags = $flags -bor [System.Windows.Forms.TextFormatFlags]::SingleLine -bor [System.Windows.Forms.TextFormatFlags]::EndEllipsis
  } else {
    $flags = $flags -bor [System.Windows.Forms.TextFormatFlags]::WordBreak
  }
  $size = [System.Windows.Forms.TextRenderer]::MeasureText($safeText, $Font, $proposed, $flags)
  $fontHeightPx = [System.Windows.Forms.TextRenderer]::MeasureText("A", $Font).Height
  return [Math]::Max($size.Height, $fontHeightPx)
}

function Measure-MessageChipLayout {
  param(
    [string]$AuthorText,
    [string]$BodyText,
    [string[]]$MetaParts = @(),
    [int]$EmoteCount = 0,
    [int]$LabelWidth,
    [bool]$HasAvatar = $false
  )

  $authorFontSize = [Math]::Max(12.0, ([double]$FontSizePx * 0.76))
  $metaFontSize = [Math]::Max(8.5, ([double]$FontSizePx * 0.58))
  $authorFont = [System.Drawing.Font]::new($script:OverlayFontFamily, [single]$authorFontSize, [System.Drawing.FontStyle]::Bold)
  $bodyFont = [System.Drawing.Font]::new($script:OverlayFontFamily, $FontSizePx, (Resolve-MessageFontStyle -Weight $MessageFontWeight))
  $metaFont = [System.Drawing.Font]::new($script:OverlayFontFamily, [single]$metaFontSize, [System.Drawing.FontStyle]::Regular)
  try {
    $hasMeta = @($MetaParts).Count -gt 0
    $metaHeightPx = if ($hasMeta) {
      [Math]::Max(20, ([System.Windows.Forms.TextRenderer]::MeasureText("Twitch", $metaFont).Height + 6))
    } else {
      0
    }
    $authorHeightPx = Measure-TextBlockHeight -Text $AuthorText -LabelWidth $LabelWidth -Font $authorFont -SingleLine
    $hasBody = -not [string]::IsNullOrWhiteSpace($BodyText)
    $bodyHeightPx = if ($hasBody) { Measure-TextBlockHeight -Text $BodyText -LabelWidth $LabelWidth -Font $bodyFont } else { 0 }
    $emoteRowHeightPx = if ($EmoteCount -gt 0) { [Math]::Max(24, [Math]::Ceiling([double]$FontSizePx * 1.65)) } else { 0 }
    $emoteGapPx = if ($EmoteCount -gt 0 -and $hasBody) { 6 } else { 0 }
    $metaGapPx = if ($hasMeta) { 6 } else { 0 }
    $contentGapPx = if ([string]::IsNullOrWhiteSpace($AuthorText) -or ($EmoteCount -eq 0 -and -not $hasBody)) { 0 } else { 6 }
    $paddingTopPx = 12
    $paddingBottomPx = 13
    $bodyRenderHeightPx = [Math]::Ceiling($bodyHeightPx * $LineHeight)
    $totalHeightPx = $paddingTopPx + $metaHeightPx + $metaGapPx + $authorHeightPx + $contentGapPx + $emoteRowHeightPx + $emoteGapPx + $bodyRenderHeightPx + $paddingBottomPx
    if ($HasAvatar) {
      $totalHeightPx = [Math]::Max($totalHeightPx, 28 + $paddingTopPx + $paddingBottomPx)
    }
    return [PSCustomObject]@{
      MetaHeightPx = $metaHeightPx
      MetaGapPx = $metaGapPx
      AuthorHeightPx = $authorHeightPx
      EmoteRowHeightPx = $emoteRowHeightPx
      EmoteGapPx = $emoteGapPx
      BodyHeightPx = $bodyRenderHeightPx
      ContentGapPx = $contentGapPx
      HeightPx = [Math]::Max(58, $totalHeightPx)
    }
  } finally {
    $metaFont.Dispose()
    $bodyFont.Dispose()
    $authorFont.Dispose()
  }
}

function Enable-DoubleBuffer {
  param(
    [System.Windows.Forms.Control]$Control
  )

  $flags = [System.Reflection.BindingFlags]::Instance -bor [System.Reflection.BindingFlags]::NonPublic
  $property = [System.Windows.Forms.Control].GetProperty("DoubleBuffered", $flags)
  if ($property) {
    $property.SetValue($Control, $true, $null)
  }
}

function New-RoundedPath {
  param(
    [System.Drawing.Rectangle]$Bounds,
    [int]$Radius
  )

  $diameter = [Math]::Max(2, $Radius * 2)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc($Bounds.X, $Bounds.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($Bounds.Right - $diameter, $Bounds.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($Bounds.Right - $diameter, $Bounds.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($Bounds.X, $Bounds.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

$script:OverlayImageCache = @{}

function Get-OverlayImage {
  param(
    [string]$Url
  )

  if ([string]::IsNullOrWhiteSpace($Url) -or $Url -notmatch '^https?://') {
    return $null
  }

  if ($script:OverlayImageCache.ContainsKey($Url)) {
    return $script:OverlayImageCache[$Url]
  }

  try {
    $client = [System.Net.WebClient]::new()
    $bytes = $client.DownloadData($Url)
    $stream = [System.IO.MemoryStream]::new($bytes)
    $image = [System.Drawing.Image]::FromStream($stream)
    $script:OverlayImageCache[$Url] = $image
    return $image
  } catch {
    return $null
  }
}

function Draw-OverlayItems {
  param(
    [System.Drawing.Graphics]$Graphics,
    [object[]]$Items,
    [System.Drawing.Color]$TransparentColor,
    [int]$CanvasWidth,
    [int]$CanvasHeight
  )

  $Graphics.Clear($TransparentColor)
  $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $Graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $authorFontSize = [Math]::Max(12.0, ([double]$FontSizePx * 0.76))
  $metaFontSize = [Math]::Max(8.5, ([double]$FontSizePx * 0.58))
  $authorFont = [System.Drawing.Font]::new($script:OverlayFontFamily, [single]$authorFontSize, [System.Drawing.FontStyle]::Bold)
  $bodyFont = [System.Drawing.Font]::new($script:OverlayFontFamily, $FontSizePx, (Resolve-MessageFontStyle -Weight $MessageFontWeight))
  $metaFont = [System.Drawing.Font]::new($script:OverlayFontFamily, [single]$metaFontSize, [System.Drawing.FontStyle]::Regular)
  $avatarFont = [System.Drawing.Font]::new($script:OverlayFontFamily, 8.5, [System.Drawing.FontStyle]::Bold)
  $authorFormat = [System.Drawing.StringFormat]::new()
  $authorFormat.Alignment = [System.Drawing.StringAlignment]::Near
  $authorFormat.LineAlignment = [System.Drawing.StringAlignment]::Near
  $authorFormat.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
  $authorFormat.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
  $centerFormat = [System.Drawing.StringFormat]::new()
  $centerFormat.Alignment = [System.Drawing.StringAlignment]::Center
  $centerFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
  $bodyFormat = [System.Drawing.StringFormat]::new()
  $bodyFormat.Alignment = [System.Drawing.StringAlignment]::Near
  $bodyFormat.LineAlignment = [System.Drawing.StringAlignment]::Near
  $bodyFormat.Trimming = [System.Drawing.StringTrimming]::EllipsisWord

  try {
    foreach ($item in @($Items)) {
      $rect = [System.Drawing.Rectangle]::new(8, [int]$item.Top, $CanvasWidth - 16, [int]$item.Height)
      if ($rect.Height -le 0 -or $rect.Width -le 0 -or $rect.Top -ge $CanvasHeight) {
        continue
      }

      $path = New-RoundedPath -Bounds $rect -Radius 8
      $bodyBrush = New-OverlayMessageBackgroundBrush -Bounds $rect -OpacityPercent $BackgroundOpacity
      $sheenBrush = New-OverlayMessageSheenBrush -Bounds $rect -OpacityPercent $BackgroundOpacity
      $borderPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb((Resolve-OverlayMessageBorderAlpha -OpacityPercent $BackgroundOpacity), 255, 255, 255), 1)
      $accentBrush = [System.Drawing.SolidBrush]::new($item.AccentColor)
      $shadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(200, 0, 0, 0))
      $messageBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(246, 250, 255))
      $authorBrush = [System.Drawing.SolidBrush]::new($item.AccentColor)
      $metaBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(235, 246, 250, 255))
      $badgeBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(31, 255, 255, 255))
      $avatarTextBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)

      try {
        $Graphics.FillPath($bodyBrush, $path)
        if ($sheenBrush) {
          $Graphics.FillPath($sheenBrush, $path)
        }
        $Graphics.DrawPath($borderPen, $path)

        $oldClip = $Graphics.Clip
        try {
          $Graphics.SetClip($path)
          $Graphics.FillRectangle($accentBrush, $rect.X, $rect.Y, 3, $rect.Height)
        } finally {
          $Graphics.Clip = $oldClip
        }

        $contentX = $rect.X + 15
        if ($item.ShowAvatar) {
          $avatarRect = [System.Drawing.RectangleF]::new($rect.X + 15, $rect.Y + 14, 28, 28)
          $Graphics.FillEllipse($accentBrush, $avatarRect)
          $Graphics.DrawString((Get-OverlayInitials -Text ([string]$item.AuthorText)), $avatarFont, $avatarTextBrush, $avatarRect, $centerFormat)
          $contentX = $avatarRect.Right + 10
        }

        $contentWidth = [Math]::Max(1, $rect.Right - $contentX - 13)
        $currentY = $rect.Y + 12
        $metaParts = @($item.MetaParts)
        if ($metaParts.Count -gt 0 -and $item.MetaHeightPx -gt 0) {
          $badgeX = $contentX
          for ($badgeIndex = 0; $badgeIndex -lt $metaParts.Count; $badgeIndex++) {
            $badgeText = [string]$metaParts[$badgeIndex]
            if ([string]::IsNullOrWhiteSpace($badgeText)) {
              continue
            }

            $maxBadgeWidth = if ($badgeIndex -eq 0) { 110 } else { 170 }
            $availableWidth = [Math]::Floor($contentX + $contentWidth - $badgeX)
            if ($availableWidth -lt 36) {
              break
            }

            $measuredBadge = [System.Windows.Forms.TextRenderer]::MeasureText($badgeText, $metaFont)
            $badgeWidth = [Math]::Min($maxBadgeWidth, [Math]::Min($availableWidth, $measuredBadge.Width + 14))
            $badgeRect = [System.Drawing.Rectangle]::new([int]$badgeX, [int]$currentY, [int]$badgeWidth, [int]$item.MetaHeightPx)
            $badgePath = New-RoundedPath -Bounds $badgeRect -Radius ([Math]::Floor($badgeRect.Height / 2))
            try {
              $Graphics.FillPath($badgeBrush, $badgePath)
            } finally {
              $badgePath.Dispose()
            }
            [System.Windows.Forms.TextRenderer]::DrawText(
              $Graphics,
              $badgeText,
              $metaFont,
              $badgeRect,
              $metaBrush.Color,
              ([System.Windows.Forms.TextFormatFlags]::HorizontalCenter -bor [System.Windows.Forms.TextFormatFlags]::VerticalCenter -bor [System.Windows.Forms.TextFormatFlags]::EndEllipsis -bor [System.Windows.Forms.TextFormatFlags]::SingleLine -bor [System.Windows.Forms.TextFormatFlags]::NoPadding)
            )
            $badgeX += $badgeWidth + 8
          }

          $currentY += $item.MetaHeightPx + $item.MetaGapPx
        }

        $authorRect = [System.Drawing.RectangleF]::new($contentX, $currentY, $contentWidth, [int]$item.AuthorHeightPx)
        $authorShadowRect = [System.Drawing.RectangleF]::new($authorRect.X + 1, $authorRect.Y + 1, $authorRect.Width, $authorRect.Height)
        $bodyY = $authorRect.Y + $item.AuthorHeightPx + $item.ContentGapPx
        $emotes = @($item.Emotes)
        if ($emotes.Count -gt 0 -and $item.EmoteRowHeightPx -gt 0) {
          $emoteSize = [Math]::Max(20, [int]$item.EmoteRowHeightPx)
          $emoteX = $contentX
          $emoteY = [int]$bodyY
          foreach ($emote in $emotes) {
            if (($emoteX + $emoteSize) -gt ($contentX + $contentWidth)) {
              break
            }

            $image = Get-OverlayImage -Url ([string]$emote.Src)
            if ($image) {
              $imageRect = [System.Drawing.Rectangle]::new([int]$emoteX, $emoteY, $emoteSize, $emoteSize)
              $Graphics.DrawImage($image, $imageRect)
              $emoteX += $emoteSize + 5
            }
          }

          $bodyY = $emoteY + $emoteSize + $item.EmoteGapPx
        }
        $bodyRect = [System.Drawing.RectangleF]::new($contentX, $bodyY, $contentWidth, [Math]::Max(0, [int]$item.BodyHeightPx))
        $bodyShadowRect = [System.Drawing.RectangleF]::new($bodyRect.X + 1, $bodyRect.Y + 1, $bodyRect.Width, $bodyRect.Height)

        $Graphics.DrawString([string]$item.AuthorText, $authorFont, $shadowBrush, $authorShadowRect, $authorFormat)
        $Graphics.DrawString([string]$item.AuthorText, $authorFont, $authorBrush, $authorRect, $authorFormat)
        if (-not [string]::IsNullOrWhiteSpace([string]$item.BodyText)) {
          $Graphics.DrawString([string]$item.BodyText, $bodyFont, $shadowBrush, $bodyShadowRect, $bodyFormat)
          $Graphics.DrawString([string]$item.BodyText, $bodyFont, $messageBrush, $bodyRect, $bodyFormat)
        }
      } finally {
        $avatarTextBrush.Dispose()
        $badgeBrush.Dispose()
        $metaBrush.Dispose()
        $authorBrush.Dispose()
        $messageBrush.Dispose()
        $shadowBrush.Dispose()
        $accentBrush.Dispose()
        $borderPen.Dispose()
        if ($sheenBrush) {
          $sheenBrush.Dispose()
        }
        $bodyBrush.Dispose()
        $path.Dispose()
      }
    }
  } finally {
    $bodyFormat.Dispose()
    $centerFormat.Dispose()
    $authorFormat.Dispose()
    $avatarFont.Dispose()
    $metaFont.Dispose()
    $bodyFont.Dispose()
    $authorFont.Dispose()
  }
}

function Render-OverlayLayer {
  param(
    [System.Windows.Forms.Form]$Form,
    [object[]]$Items,
    [int]$CanvasWidth,
    [int]$CanvasHeight
  )

  if (-not $Form.IsHandleCreated -or $CanvasWidth -le 0 -or $CanvasHeight -le 0) {
    return
  }

  $bitmap = [System.Drawing.Bitmap]::new($CanvasWidth, $CanvasHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppPArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

  try {
    Draw-OverlayItems -Graphics $graphics -Items $Items -TransparentColor ([System.Drawing.Color]::Transparent) -CanvasWidth $CanvasWidth -CanvasHeight $CanvasHeight
    [LiveChatOverlayRuntimeNative]::UpdateLayeredWindowBitmap($Form, $bitmap)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$selectedScreen = Get-SelectedScreen -TargetDisplayId $DisplayId
$showPlatformBadgeEnabled = Convert-ToOverlayBool -Value $ShowPlatformBadge
$showChannelEnabled = Convert-ToOverlayBool -Value $ShowChannel
$showAvatarEnabled = Convert-ToOverlayBool -Value $ShowAvatar
$filterMessagesEnabled = Convert-ToOverlayBool -Value $FilterMessages
$filterJoinsEnabled = Convert-ToOverlayBool -Value $FilterJoins
$filterAudienceEnabled = Convert-ToOverlayBool -Value $FilterAudienceUpdates
$filterTechnicalEnabled = Convert-ToOverlayBool -Value $FilterTechnicalEvents
$screen = $selectedScreen.WorkingArea
$left = if ($Position.EndsWith("right")) {
  $screen.Right - $Width - $OffsetX
} else {
  $screen.Left + $OffsetX
}
$top = if ($Position.StartsWith("bottom")) {
  $screen.Bottom - $Height - $OffsetY
} else {
  $screen.Top + $OffsetY
}
$left = [Math]::Max($screen.Left, [Math]::Min($screen.Right - $Width, $left))
$top = [Math]::Max($screen.Top, [Math]::Min($screen.Bottom - $Height, $top))

$form = [LiveChatNoActivateOverlayForm]::new()
$form.Text = "Live Control - CHAThub - Overlay"
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Size = [System.Drawing.Size]::new($Width, $Height)
$form.Location = [System.Drawing.Point]::new($left, $top)
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.BackColor = [System.Drawing.Color]::Black
$form.Opacity = 1.0
Enable-DoubleBuffer -Control $form
$script:OverlayRenderItems = @()
$script:OverlayTickCounter = 0
$script:OverlayLastTickSummary = ""
Write-OverlayLog "Form configurado. Left=[$($form.Left)] Top=[$($form.Top)] Size=[$($form.Width)x$($form.Height)] TopMost=[$($form.TopMost)]"

$timer = [System.Windows.Forms.Timer]::new()
$timer.Interval = $PollMs
$allowedOverlayPlatforms = Get-OverlayPlatforms -Json $PlatformsJson

$timer.Add_Tick({
  $timer.Stop()
  $script:OverlayTickCounter += 1
  try {
    $response = Invoke-RestMethod -Uri "$RuntimeUrl/api/snapshot" -Method Get -TimeoutSec 2
    $snapshot = $response.snapshot
    $cutoff = (Get-Date).ToUniversalTime().AddMilliseconds(-1 * $DurationMs)
    $messages = @(
      Get-OverlayItems -Snapshot $snapshot -CutoffUtc $cutoff -AllowedPlatforms $allowedOverlayPlatforms |
        Select-Object -First $MaxMessages
    )

    $currentTop = 0
    $renderItems = New-Object System.Collections.Generic.List[object]
    for ($i = 0; $i -lt $messages.Count; $i++) {
      $message = $messages[$i]
      try {
        $author = ([string]$message.author).Trim()
        if (-not $author) {
          $author = [string]$message.platform_label
        }

        $metaParts = @()
        if ($showPlatformBadgeEnabled -and $message.platform_label) {
          $metaParts += [string]$message.platform_label
        }
        if ($showChannelEnabled -and $message.channel) {
          $metaParts += [string]$message.channel
        }

        $text = ([string]$message.body).Trim()

        $displayAuthor = Format-OverlayAuthorText -Text $author
        $labelWidth = $Width - 44
        if ($showAvatarEnabled) {
          $labelWidth -= 38
        }
        $labelWidth = [Math]::Max(1, $labelWidth)
        $emotes = @($message.emotes)
        $layout = Measure-MessageChipLayout -AuthorText $displayAuthor -BodyText $text -MetaParts @($metaParts) -EmoteCount $emotes.Count -LabelWidth $labelWidth -HasAvatar $showAvatarEnabled
        $accentColor = Convert-HexColor -Hex $message.accent_color -Fallback ([System.Drawing.Color]::White)
        $chipHeight = [int]$layout.HeightPx
        if (($currentTop + $chipHeight) -gt $Height) {
          continue
        }

        $renderItems.Add([PSCustomObject]@{
          Top = $currentTop
          Height = $chipHeight
          MetaParts = @($metaParts)
          MetaHeightPx = $layout.MetaHeightPx
          MetaGapPx = $layout.MetaGapPx
          Emotes = @($emotes)
          EmoteRowHeightPx = $layout.EmoteRowHeightPx
          EmoteGapPx = $layout.EmoteGapPx
          AuthorText = $displayAuthor
          BodyText = $text
          AuthorHeightPx = $layout.AuthorHeightPx
          BodyHeightPx = $layout.BodyHeightPx
          ContentGapPx = $layout.ContentGapPx
          AccentColor = $accentColor
          ShowAvatar = $showAvatarEnabled
        }) | Out-Null
        $currentTop += $chipHeight + $GapPx
      } catch {
        Write-OverlayLog ("ERRO render item idx=[{0}] source=[{1}] author=[{2}] msg=[{3}]" -f $i, [string]$message.source, [string]$author, $_.Exception.Message)
      }
    }

    $script:OverlayRenderItems = @($renderItems.ToArray())
    Render-OverlayLayer -Form $form -Items $script:OverlayRenderItems -CanvasWidth $form.Width -CanvasHeight $form.Height

    $summary = "{0}:{1}" -f $messages.Count, $script:OverlayRenderItems.Count
    if ($script:OverlayTickCounter -le 3 -or $summary -ne $script:OverlayLastTickSummary) {
      Write-OverlayLog ("Tick ok. source_items=[{0}] rendered_items=[{1}]" -f $messages.Count, $script:OverlayRenderItems.Count)
      $script:OverlayLastTickSummary = $summary
    }
  } catch {
    $script:OverlayRenderItems = @()
    Render-OverlayLayer -Form $form -Items $script:OverlayRenderItems -CanvasWidth $form.Width -CanvasHeight $form.Height
    Write-OverlayLog "ERRO no tick do overlay: $($_.Exception.Message)"
  } finally {
    $timer.Start()
  }
})

$form.Add_Shown({
  Write-OverlayLog "Add_Shown disparado. Janela visivel."
  Set-ClickThrough -Form $form -Enabled (-not [bool]$Interactive)
  Render-OverlayLayer -Form $form -Items $script:OverlayRenderItems -CanvasWidth $form.Width -CanvasHeight $form.Height
  $timer.Start()
  $readyUrl = "$RuntimeUrl/api/overlay/ready"
  Write-OverlayLog "Enviando ready POST: [$readyUrl]"
  try {
    $readyBody = [PSCustomObject]@{
      pid     = [System.Diagnostics.Process]::GetCurrentProcess().Id
      x       = $form.Left
      y       = $form.Top
      width   = $form.Width
      height  = $form.Height
      monitor = $selectedScreen.DeviceName
    } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri $readyUrl -Method Post `
      -Body $readyBody -ContentType 'application/json' -TimeoutSec 5 | Out-Null
    Write-OverlayLog "Ready POST enviado com sucesso."
  } catch {
    Write-OverlayLog "ERRO no ready POST: $($_.Exception.Message)"
  }
})

$form.Add_FormClosed({
  $timer.Stop()
  $timer.Dispose()
})

Write-OverlayLog "Chamando Application::Run..."
[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::Run($form)
Write-OverlayLog "Application::Run retornou."
