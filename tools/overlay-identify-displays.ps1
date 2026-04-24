#        __     __                   
# _|_   (_ ||\/|__) /\ _ _ _ _|   _  
#  |    __)||  |__)/--|_| (_(_||_|/_ 
#                     |  

param(
  [int]$DurationMs = 1600
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$forms = New-Object System.Collections.Generic.List[System.Windows.Forms.Form]

try {
  $screens = [System.Windows.Forms.Screen]::AllScreens
  $index = 1

  foreach ($screen in $screens) {
    $form = [System.Windows.Forms.Form]::new()
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $form.TopMost = $true
    $form.ShowInTaskbar = $false
    $form.BackColor = [System.Drawing.Color]::FromArgb(18, 21, 27)
    $form.Opacity = 0.94
    $form.Size = [System.Drawing.Size]::new(320, 160)

    $x = $screen.WorkingArea.X + [Math]::Max(24, ($screen.WorkingArea.Width - $form.Width) / 2)
    $y = $screen.WorkingArea.Y + [Math]::Max(24, ($screen.WorkingArea.Height - $form.Height) / 2)
    $form.Location = [System.Drawing.Point]::new([int]$x, [int]$y)

    $title = [System.Windows.Forms.Label]::new()
    $title.AutoSize = $false
    $title.Left = 20
    $title.Top = 20
    $title.Width = 280
    $title.Height = 36
    $title.Font = [System.Drawing.Font]::new("Segoe UI", 22, [System.Drawing.FontStyle]::Bold)
    $title.ForeColor = [System.Drawing.Color]::White
    $title.Text = "Monitor $index"

    $meta = [System.Windows.Forms.Label]::new()
    $meta.AutoSize = $false
    $meta.Left = 20
    $meta.Top = 74
    $meta.Width = 280
    $meta.Height = 54
    $meta.Font = [System.Drawing.Font]::new("Segoe UI", 10, [System.Drawing.FontStyle]::Regular)
    $meta.ForeColor = [System.Drawing.Color]::FromArgb(210, 226, 236)
    $meta.Text = "$($screen.DeviceName)`r`n$($screen.Bounds.Width)x$($screen.Bounds.Height)$(if ($screen.Primary) { ' · Principal' } else { '' })"

    $form.Controls.Add($title)
    $form.Controls.Add($meta)
    $forms.Add($form) | Out-Null
    $index += 1
  }

  foreach ($form in $forms) {
    $form.Show()
  }

  Start-Sleep -Milliseconds $DurationMs
}
finally {
  foreach ($form in $forms) {
    try {
      $form.Close()
      $form.Dispose()
    } catch {
      # ignore
    }
  }
}
