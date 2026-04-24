#        __     __                   
# _|_   (_ ||\/|__) /\ _ _ _ _|   _  
#  |    __)||  |__)/--|_| (_(_||_|/_ 
#                     |  

param(
  [string]$RuntimeUrl = "http://localhost:4310",
  [int]$Width = 420,
  [int]$Height = 160,
  [string]$DisplayId = "primary"
)

# Ferramenta de diagnostico minima: WinForms simples, sem Add-Type customizado, sem timer de poll.
# Roda com: powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File overlay-diagnostic.ps1

$logPath = Join-Path $PSScriptRoot "..\runtime\overlay-diagnostic.log"

function Write-DiagLog {
  param([string]$Message)
  $ts = Get-Date -Format "HH:mm:ss.fff"
  $line = "[$ts] $Message"
  try { Add-Content -Path $logPath -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue } catch {}
  Write-Host $line
}

Write-DiagLog "=== overlay-diagnostic.ps1 iniciando ==="
Write-DiagLog "RuntimeUrl=[$RuntimeUrl] DisplayId=[$DisplayId]"
Write-DiagLog "PID=[$([System.Diagnostics.Process]::GetCurrentProcess().Id)]"

try {
  Write-DiagLog "Carregando assemblies..."
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Write-DiagLog "Assemblies carregados."

  $screens = [System.Windows.Forms.Screen]::AllScreens
  Write-DiagLog "Monitores disponiveis: $(($screens | ForEach-Object { $_.DeviceName }) -join ', ')"

  $screen = if ($DisplayId -and $DisplayId -ne "primary") {
    $screens | Where-Object { $_.DeviceName -eq $DisplayId } | Select-Object -First 1
  } else { $null }
  if (-not $screen) { $screen = $screens | Where-Object Primary | Select-Object -First 1 }
  Write-DiagLog "Monitor selecionado: [$($screen.DeviceName)] WorkingArea=[$($screen.WorkingArea)]"

  $form = [System.Windows.Forms.Form]::new()
  $form.Text = "Live Control - CHAThub Overlay Diagnostic"
  $form.Size = [System.Drawing.Size]::new($Width, $Height)
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $form.Location = [System.Drawing.Point]::new($screen.WorkingArea.Left + 32, $screen.WorkingArea.Top + 96)
  $form.BackColor = [System.Drawing.Color]::FromArgb(18, 18, 28)
  $form.ForeColor = [System.Drawing.Color]::White
  $form.TopMost = $true
  $form.ShowInTaskbar = $true
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle

  $label = [System.Windows.Forms.Label]::new()
  $label.Text = "Live Control - CHAThub Overlay Diagnostic`nSe esta janela e visivel, WinForms funciona.`nFechando em 10s..."
  $label.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
  $label.Dock = [System.Windows.Forms.DockStyle]::Fill
  $label.Font = [System.Drawing.Font]::new("Segoe UI", 11)
  $label.ForeColor = [System.Drawing.Color]::FromArgb(220, 240, 255)
  $form.Controls.Add($label)

  Write-DiagLog "Form criado. Left=[$($form.Left)] Top=[$($form.Top)] Size=[$($form.Width)x$($form.Height)]"

  $form.Add_Shown({
    Write-DiagLog "Add_Shown disparado. Janela visivel!"
    $readyUrl = "$RuntimeUrl/api/overlay/ready"
    Write-DiagLog "Enviando ready POST: [$readyUrl]"
    try {
      $body = [PSCustomObject]@{
        pid     = [System.Diagnostics.Process]::GetCurrentProcess().Id
        x       = $form.Left
        y       = $form.Top
        width   = $form.Width
        height  = $form.Height
        monitor = $screen.DeviceName
      } | ConvertTo-Json -Compress
      $result = Invoke-RestMethod -Uri $readyUrl -Method Post `
        -Body $body -ContentType 'application/json' -TimeoutSec 5
      Write-DiagLog "Ready POST OK. Resposta: $($result | ConvertTo-Json -Compress)"
    } catch {
      Write-DiagLog "ERRO no ready POST: $($_.Exception.Message)"
    }

    $closeTimer = [System.Windows.Forms.Timer]::new()
    $closeTimer.Interval = 10000
    $closeTimer.Add_Tick({
      $closeTimer.Stop()
      Write-DiagLog "Auto-fechando apos 10s."
      $form.Close()
    })
    $closeTimer.Start()
  })

  $form.Add_FormClosed({
    Write-DiagLog "Form fechado."
  })

  Write-DiagLog "Chamando Application::Run..."
  [System.Windows.Forms.Application]::EnableVisualStyles()
  [System.Windows.Forms.Application]::Run($form)
  Write-DiagLog "Application::Run retornou."

} catch {
  Write-DiagLog "EXCECAO FATAL: $($_.Exception.Message)"
  Write-DiagLog "Stack: $($_.ScriptStackTrace)"
  throw
}
