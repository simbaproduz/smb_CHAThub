#        __     __                   
# _|_   (_ ||\/|__) /\ _ _ _ _|   _  
#  |    __)||  |__)/--|_| (_(_||_|/_ 
#                     |  

param()

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms

[System.Windows.Forms.Screen]::AllScreens |
  ForEach-Object {
    [PSCustomObject]@{
      display_id = $_.DeviceName
      device_name = $_.DeviceName
      bounds = @{
        x = $_.Bounds.X
        y = $_.Bounds.Y
        width = $_.Bounds.Width
        height = $_.Bounds.Height
      }
      working_area = @{
        x = $_.WorkingArea.X
        y = $_.WorkingArea.Y
        width = $_.WorkingArea.Width
        height = $_.WorkingArea.Height
      }
      primary = [bool]$_.Primary
      label = if ($_.Primary) {
        "Principal"
      } else {
        "Secundario"
      }
    }
  } |
  ConvertTo-Json -Depth 6
