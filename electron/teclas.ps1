# Vigia de teclas do LolCoach.
#
# O atalho global do Electron (RegisterHotKey) não dispara enquanto o jogo
# está com o foco. Isto aqui faz o que o Discord faz pro push-to-talk: só
# PERGUNTA ao Windows se a tecla está apertada (GetAsyncKeyState), 40x por
# segundo, e avisa o app pela porta local. Nada é enviado pro jogo, nada é
# lido do jogo. Um processo só, iniciado pelo app e encerrado com ele.
#
#   teclas.ps1 -Porta 8770 -Teclas "flash1=num1;flash2=Control+Alt+2;overlay=F9"
param([int]$Porta = 8770, [string]$Teclas = '')

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Tecla {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] public static extern short GetKeyState(int vk);
}
"@

function VkDe([string]$nome) {
  $n = $nome.Trim()
  if ($n -match '^num(\d)$') { return 0x60 + [int]$matches[1] }
  if ($n -match '^F(\d{1,2})$') { return 0x6F + [int]$matches[1] }
  if ($n -match '^[0-9]$') { return 0x30 + [int]$n }
  if ($n -match '^[A-Za-z]$') { return [int][char]$n.ToUpper() }
  switch ($n) {
    'Space' { return 0x20 } 'Tab' { return 0x09 } 'Insert' { return 0x2D } 'Delete' { return 0x2E }
    'Home' { return 0x24 } 'End' { return 0x23 } 'PageUp' { return 0x21 } 'PageDown' { return 0x22 }
  }
  return 0
}

$mapa = @{}
foreach ($par in $Teclas.Split(';')) {
  if (-not $par.Contains('=')) { continue }
  $acao, $acel = $par.Split('=', 2)
  $partes = $acel.Split('+')
  $vk = VkDe $partes[-1]
  if ($vk -eq 0) { continue }
  $mapa[$acao] = @{
    vk = $vk
    ctrl = ($partes -contains 'Control'); alt = ($partes -contains 'Alt'); shift = ($partes -contains 'Shift')
  }
}
if ($mapa.Count -eq 0) { exit 0 }

$apertada = @{}
$web = New-Object System.Net.WebClient
$numlock = -1
$ciclo = 0
while ($true) {
  # NumLock desligado = Num1..9 viram End/Seta e as teclas do app não funcionam: avisa o app quando mudar (a cada ~2 s)
  $ciclo++
  if ($ciclo % 80 -eq 0) {
    $nl = ([Tecla]::GetKeyState(0x90) -band 1)
    if ($nl -ne $numlock) { $numlock = $nl; try { $web.UploadString("http://127.0.0.1:$Porta/api/tecla?acao=numlock-$nl", 'POST', '') | Out-Null } catch {} }
  }
  foreach ($acao in @($mapa.Keys)) {
    $d = $mapa[$acao]
    $agora = ([Tecla]::GetAsyncKeyState($d.vk) -band 0x8000) -ne 0
    if ($agora -and -not $apertada[$acao]) {
      $ctrl = ([Tecla]::GetAsyncKeyState(0x11) -band 0x8000) -ne 0
      $alt = ([Tecla]::GetAsyncKeyState(0x12) -band 0x8000) -ne 0
      $shift = ([Tecla]::GetAsyncKeyState(0x10) -band 0x8000) -ne 0
      # Modificador exigido tem que estar; modificador não exigido não pode estar
      # (senão Ctrl+1 dispararia o "1" solto).
      if ($ctrl -eq $d.ctrl -and $alt -eq $d.alt -and $shift -eq $d.shift) {
        try { $web.UploadString("http://127.0.0.1:$Porta/api/tecla?acao=$acao", 'POST', '') | Out-Null } catch {}
      }
    }
    $apertada[$acao] = $agora
  }
  Start-Sleep -Milliseconds 25
}
