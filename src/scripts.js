// Scripts PowerShell usados pelo app
const { psParam } = require('./powershell');

// Apps de fábrica / propaganda que normalmente podem sair sem problema
const BLOATWARE = [
  'CandyCrush', 'BubbleWitch', 'FarmVille', 'MarchofEmpires', 'Disney', 'TikTok', 'McAfee', 'Norton',
  'WildTangent', 'ExpressVPN', 'Booking', 'Amazon\\.com', 'king\\.com', 'Facebook', 'Instagram',
  'LinkedInforWindows', 'PrimeVideo', 'Netflix', 'Microsoft\\.BingNews', 'Microsoft\\.BingWeather',
  'Microsoft\\.GetHelp', 'Microsoft\\.Getstarted', 'MicrosoftSolitaireCollection', 'Microsoft\\.People',
  'WindowsFeedbackHub', 'Microsoft\\.ZuneVideo', 'Microsoft\\.ZuneMusic', 'MixedReality\\.Portal',
  'Microsoft\\.SkypeApp', 'Clipchamp', 'MicrosoftOfficeHub', 'Microsoft\\.549981C3F5F10'
].join('|');

// Nunca sugerir: drivers, runtimes e componentes do sistema
const PROTEGIDOS = 'Visual C\\+\\+|\\.NET|DirectX|Driver|NVIDIA|AMD|Intel|Realtek|Defender|Edge|WebView2|Store|VCLibs|UI\\.Xaml|NET\\.Native|Runtime|Windows SDK|Microsoft Update|Security';

const RUIM = 'trial|teste|demo|toolbar|optimizer|cleaner|booster|driver updater|pc ?fix|registry';

const status = `
$os = Get-CimInstance Win32_OperatingSystem
$discos = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
  [pscustomobject]@{ disco=$_.DeviceID; livreGB=[math]::Round($_.FreeSpace/1GB,1); totalGB=[math]::Round($_.Size/1GB,1) } }
$temp = 0
foreach ($p in @($env:TEMP, 'C:\\Windows\\Temp')) { $temp += (Get-ChildItem $p -Recurse -Force | Measure-Object Length -Sum).Sum }
$lixeira = 0
try { $sh = New-Object -ComObject Shell.Application; $sh.Namespace(10).Items() | ForEach-Object { $lixeira += $_.Size } } catch {}
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
# Placa de vídeo: nome e memória dedicada real (registro tem o valor de 64 bits; AdapterRAM trava em 4 GB)
$vc = Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Basic|Remote|Virtual' } | Select-Object -First 1
$vram = (Get-ItemProperty 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -Name 'HardwareInformation.qwMemorySize' | ForEach-Object { $_.'HardwareInformation.qwMemorySize' } | Measure-Object -Maximum).Maximum
if (-not $vram -and $vc) { $vram = $vc.AdapterRAM }
$defender = $null
try { $mp = Get-MpComputerStatus -ErrorAction Stop; $defender = @{ tempoReal = [bool]$mp.RealTimeProtectionEnabled; antivirus = [bool]$mp.AntivirusEnabled } } catch {}
[pscustomobject]@{
  gpu = if ($vc) { @{ nome = $vc.Name.Trim(); vramGB = if ($vram) { [math]::Round($vram/1GB,1) } else { $null } } } else { $null }
  defender = $defender
  pc = $env:COMPUTERNAME
  windows = $os.Caption
  ramTotalGB = [math]::Round($os.TotalVisibleMemorySize/1MB,1)
  ramLivreGB = [math]::Round($os.FreePhysicalMemory/1MB,1)
  ligadoHa = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours,0)
  discos = @($discos)
  lixoMB = [math]::Round(($temp + $lixeira)/1MB,0)
  admin = $admin
} | ConvertTo-Json -Depth 4 -Compress
`;

const listarApps = `
$bloat = '${BLOATWARE}'; $prot = '${PROTEGIDOS}'; $ruim = '${RUIM}'
$chaves = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
          'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
          'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
$lista = @()
Get-ItemProperty $chaves | Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName -and ($_.UninstallString -or $_.QuietUninstallString) } | ForEach-Object {
  $data = $null; if ($_.InstallDate -match '^\\d{8}$') { $data = "$($_.InstallDate.Substring(6,2))/$($_.InstallDate.Substring(4,2))/$($_.InstallDate.Substring(0,4))" }
  $lista += [pscustomobject]@{ tipo='programa'; nome=$_.DisplayName.Trim(); versao=$_.DisplayVersion; fabricante=$_.Publisher
    tamanhoMB = if ($_.EstimatedSize) { [math]::Round($_.EstimatedSize/1024,0) } else { 0 }
    instalado=$data; ano = if ($data) { [int]$_.InstallDate.Substring(0,4) } else { 0 }
    desinstalar = if ($_.QuietUninstallString) { $_.QuietUninstallString } else { $_.UninstallString } }
}
Get-AppxPackage | Where-Object { -not $_.IsFramework -and $_.SignatureKind -ne 'System' -and -not $_.NonRemovable } | ForEach-Object {
  $lista += [pscustomobject]@{ tipo='store'; nome=$_.Name; versao="$($_.Version)"; fabricante=($_.Publisher -replace '^CN=([^,]+).*','$1')
    tamanhoMB=0; instalado=$null; ano=0; desinstalar=$_.PackageFullName }
}
$lista = $lista | Sort-Object nome -Unique
$base = { param($n) (($n -replace '[\\d\\.\\(\\)x\\-]+','') -replace '\\s+',' ').Trim() }
$dups = $lista | Where-Object tipo -eq 'programa' | Group-Object { & $base $_.nome } | Where-Object Count -gt 1 | ForEach-Object Name
$anoLimite = (Get-Date).Year - 2
$lista | ForEach-Object {
  $m = @(); $nivel = 'ok'
  if ($_.nome -match $prot -and $_.nome -notmatch $ruim) { $nivel = 'sistema' }
  else {
    if ($_.nome -match $bloat) { $m += 'Bloatware / propaganda'; $nivel = 'remover' }
    if ($_.nome -match $ruim) { $m += 'Trial ou "otimizador" duvidoso'; $nivel = 'remover' }
    if ($_.tipo -eq 'programa' -and $dups -contains (& $base $_.nome)) { $m += 'Possível versão duplicada'; if ($nivel -eq 'ok') { $nivel = 'revisar' } }
    if ($_.tamanhoMB -ge 1024) { $m += "Ocupa muito espaço ($($_.tamanhoMB) MB)"; if ($nivel -eq 'ok') { $nivel = 'revisar' } }
    if ($_.ano -gt 0 -and $_.ano -lt $anoLimite) { $m += 'Instalado há mais de 2 anos'; if ($nivel -eq 'ok') { $nivel = 'revisar' } }
  }
  $_ | Add-Member motivos ($m -join ' · ') -PassThru | Add-Member nivel $nivel -PassThru
} | ConvertTo-Json -Depth 3 -Compress
`;

const desinstalar = (app) => `
$a = ${psParam(app)}
try {
  if ($a.tipo -eq 'store') { Remove-AppxPackage -Package $a.desinstalar -ErrorAction Stop }
  elseif ($a.desinstalar -match 'msiexec') {
    $guid = [regex]::Match($a.desinstalar, '\\{[0-9A-Fa-f\\-]+\\}').Value
    $p = Start-Process msiexec.exe -ArgumentList "/x $guid /qb /norestart" -Wait -PassThru
    if ($p.ExitCode -notin 0,1605,3010) { throw "msiexec retornou $($p.ExitCode)" }
  } else { Start-Process cmd.exe -ArgumentList "/c \`"$($a.desinstalar)\`"" -Wait }
  @{ ok=$true } | ConvertTo-Json -Compress
} catch { @{ ok=$false; erro=$_.Exception.Message } | ConvertTo-Json -Compress }
`;

// Programas que abrem junto com o Windows. Desativar usa a mesma chave do Gerenciador de Tarefas (reversível).
const listarInicializacao = `
$fontes = @(
  @{ hive='HKCU'; run='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; apr='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run' },
  @{ hive='HKLM'; run='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; apr='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run' },
  @{ hive='HKLM32'; run='HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'; apr='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32' }
)
$itens = @()
# Editor (fabricante) lido das propriedades do executável; só o nome do arquivo vai para a tela
function Exe($cmd) {
  $c = [Environment]::ExpandEnvironmentVariables("$cmd")
  $m = [regex]::Match($c, '^\\s*"([^"]+)"'); if ($m.Success) { return $m.Groups[1].Value }
  $m = [regex]::Match($c, '^\\s*(.+?\\.(exe|lnk|bat|cmd))', 'IgnoreCase'); if ($m.Success) { return $m.Groups[1].Value }
  return $c
}
function Editor($arq) {
  if ($arq -like '*.lnk') { try { $arq = (New-Object -ComObject WScript.Shell).CreateShortcut($arq).TargetPath } catch {} }
  if ($arq -and (Test-Path -LiteralPath $arq)) { "$((Get-Item -LiteralPath $arq).VersionInfo.CompanyName)".Trim() } else { '' }
}
$essenciais = 'SecurityHealth|WindowsDefender|Windows Defender'
foreach ($f in $fontes) {
  $props = Get-ItemProperty $f.run
  if (-not $props) { continue }
  $props.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object {
    $v = (Get-ItemProperty $f.apr -Name $_.Name).($_.Name)
    $arq = Exe $_.Value
    $itens += [pscustomobject]@{ nome=$_.Name; arquivo=(Split-Path $arq -Leaf); editor=(Editor $arq); origem=$f.hive; aprovado=$f.apr
      ativo = -not ($v -and ($v[0] % 2 -eq 1)); essencial = ($_.Name -match $essenciais) }
  }
}
$pasta = [Environment]::GetFolderPath('Startup')
Get-ChildItem $pasta -File | Where-Object Name -ne 'desktop.ini' | ForEach-Object {
  $apr = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder'
  $v = (Get-ItemProperty $apr -Name $_.Name).($_.Name)
  $itens += [pscustomobject]@{ nome=$_.BaseName; arquivo=$_.Name; editor=(Editor $_.FullName); origem='Pasta Inicializar'; aprovado=$apr
    ativo = -not ($v -and ($v[0] % 2 -eq 1)); essencial = $false; chave = $_.Name }
}
ConvertTo-Json @($itens) -Depth 3 -Compress
`;

const alternarInicializacao = (item, ativar) => `
$i = ${psParam(item)}
try {
  if (-not (Test-Path $i.aprovado)) { New-Item -Path $i.aprovado -Force | Out-Null }
  $b = [byte[]](0,0,0,0,0,0,0,0,0,0,0,0)
  $b[0] = ${ativar ? 2 : 3}
  $n = if ($i.chave) { $i.chave } else { $i.nome }
  Set-ItemProperty -Path $i.aprovado -Name $n -Value $b -Type Binary -ErrorAction Stop
  @{ ok=$true } | ConvertTo-Json -Compress
} catch { @{ ok=$false; erro=$_.Exception.Message } | ConvertTo-Json -Compress }
`;


// ===================== LIMPEZA AMPLIADA =====================
// Cada alvo: caminhos (aceitam curingas *). O conteúdo das pastas é apagado, as pastas ficam.
const ALVOS_LIMPEZA = [
  { id: 'temp', nome: 'Arquivos temporários', desc: 'Sobras de instalações e programas', padrao: true,
    caminhos: ['$env:TEMP', 'C:\\Windows\\Temp'] },
  // Lixeira tem arquivos pessoais (já apagados): fica desmarcada por padrão
  { id: 'lixeira', nome: 'Lixeira', desc: 'Arquivos pessoais que você já apagou — esvaziar é definitivo', padrao: false, especial: true },
  { id: 'navegadores', nome: 'Cache dos navegadores', desc: 'Chrome, Edge, Brave, Opera e Firefox (não apaga senhas nem histórico)', padrao: true,
    caminhos: [
      '$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\*\\Cache', '$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\*\\Code Cache', '$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\*\\GPUCache',
      '$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data\\*\\Cache', '$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data\\*\\Code Cache', '$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data\\*\\GPUCache',
      '$env:LOCALAPPDATA\\BraveSoftware\\Brave-Browser\\User Data\\*\\Cache', '$env:LOCALAPPDATA\\BraveSoftware\\Brave-Browser\\User Data\\*\\Code Cache',
      '$env:APPDATA\\Opera Software\\Opera Stable\\Cache', '$env:LOCALAPPDATA\\Opera Software\\Opera GX Stable\\Cache',
      '$env:LOCALAPPDATA\\Mozilla\\Firefox\\Profiles\\*\\cache2'] },
  { id: 'apps', nome: 'Cache de apps', desc: 'Discord, Teams, VS Code, Steam (web) e Epic', padrao: true,
    caminhos: [
      '$env:APPDATA\\discord\\Cache', '$env:APPDATA\\discord\\Code Cache', '$env:APPDATA\\discord\\GPUCache',
      '$env:APPDATA\\Microsoft\\Teams\\Cache', '$env:LOCALAPPDATA\\Packages\\MSTeams_*\\LocalCache\\Microsoft\\MSTeams\\EBWebView\\Default\\Cache',
      '$env:APPDATA\\Code\\Cache', '$env:APPDATA\\Code\\CachedData', '$env:APPDATA\\Code\\GPUCache',
      '$env:LOCALAPPDATA\\Steam\\htmlcache', '$env:LOCALAPPDATA\\EpicGamesLauncher\\Saved\\webcache*'] },
  { id: 'miniaturas', nome: 'Cache de miniaturas e ícones', desc: 'O Windows recria quando precisar', padrao: true,
    caminhos: ['$env:LOCALAPPDATA\\Microsoft\\Windows\\Explorer\\thumbcache_*.db', '$env:LOCALAPPDATA\\Microsoft\\Windows\\Explorer\\iconcache_*.db'], arquivos: true },
  { id: 'erros', nome: 'Relatórios de erro e dumps', desc: 'Travamentos antigos e relatórios do Windows', padrao: true,
    caminhos: ['$env:LOCALAPPDATA\\CrashDumps', 'C:\\Windows\\Minidump', 'C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportArchive', 'C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportQueue', '$env:LOCALAPPDATA\\Microsoft\\Windows\\WER'] },
  { id: 'logs', nome: 'Logs antigos do sistema', desc: 'Arquivos de log do Windows e de instalações', padrao: true, admin: true,
    caminhos: ['C:\\Windows\\Logs\\CBS\\*.log', 'C:\\Windows\\Logs\\DISM\\*.log', 'C:\\Windows\\Panther\\*.log', 'C:\\Windows\\*.log'], arquivos: true },
  { id: 'update', nome: 'Cache do Windows Update', desc: 'Downloads de atualizações já instaladas', padrao: true, admin: true,
    caminhos: ['C:\\Windows\\SoftwareDistribution\\Download'] },
  { id: 'entrega', nome: 'Otimização de Entrega', desc: 'Pedaços de updates compartilhados com outros PCs', padrao: true, admin: true,
    caminhos: ['C:\\Windows\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Cache'] },
  { id: 'shaders', nome: 'Cache de shaders (jogos/GPU)', desc: 'DirectX, AMD e NVIDIA. Os jogos recriam — pode travar um pouco na 1ª vez', padrao: false,
    caminhos: ['$env:LOCALAPPDATA\\D3DSCache', '$env:LOCALAPPDATA\\AMD\\DxCache', '$env:LOCALAPPDATA\\AMD\\DxcCache', '$env:LOCALAPPDATA\\AMD\\GLCache', '$env:LOCALAPPDATA\\AMD\\VkCache', '$env:LOCALAPPDATA\\NVIDIA\\DXCache', '$env:LOCALAPPDATA\\NVIDIA\\GLCache'] },
  { id: 'dev', nome: 'Cache de programação', desc: 'npm, pip, yarn e NuGet — baixam de novo quando precisar', padrao: false,
    caminhos: ['$env:LOCALAPPDATA\\npm-cache', '$env:APPDATA\\npm-cache', '$env:LOCALAPPDATA\\pip\\Cache', '$env:LOCALAPPDATA\\Yarn\\Cache', '$env:LOCALAPPDATA\\NuGet\\v3-cache'] },
  { id: 'recentes', nome: 'Lista de arquivos recentes', desc: 'Atalhos de "Recentes" do Explorer (não apaga os arquivos)', padrao: false,
    caminhos: ['$env:APPDATA\\Microsoft\\Windows\\Recent\\*.lnk'], arquivos: true },
  { id: 'dns', nome: 'Cache de DNS', desc: 'Ajuda quando sites não carregam', padrao: true, especial: true }
];

// Converte a lista para PowerShell
const alvosPS = () => '@(' + ALVOS_LIMPEZA.filter((a) => a.caminhos).map((a) =>
  `@{ id='${a.id}'; arquivos=$${!!a.arquivos}; caminhos=@(${a.caminhos.map((c) => `"${c}"`).join(',')}) }`).join(',') + ')';

const funcoesLimpeza = `
function Resolver($padrao) { Resolve-Path -Path $padrao -ErrorAction SilentlyContinue | ForEach-Object { $_.ProviderPath } }
function Tamanho($alvo) {
  $t = 0
  foreach ($c in $alvo.caminhos) { foreach ($p in (Resolver $c)) {
    if ($alvo.arquivos) { $t += (Get-Item -LiteralPath $p -Force).Length }
    else { $t += (Get-ChildItem -LiteralPath $p -Recurse -Force -File | Measure-Object Length -Sum).Sum }
  } }
  [math]::Round($t/1MB,0)
}
`;

const escanearLimpeza = `
${funcoesLimpeza}
$r = @{}
foreach ($a in ${alvosPS()}) { $r[$a.id] = Tamanho $a }
$lix = 0; try { (New-Object -ComObject Shell.Application).Namespace(10).Items() | ForEach-Object { $lix += $_.Size } } catch {}
$r['lixeira'] = [math]::Round($lix/1MB,0)
$r['dns'] = 0
$r | ConvertTo-Json -Compress
`;

const limpar = (ids) => `
${funcoesLimpeza}
$ids = ${psParam(ids)}
$antes = (Get-PSDrive C).Free
$feito = @()
$falhas = @()
# Todo comando vai para *> $null: qualquer texto extra no stdout (ex.: "Deleting..." do Delete-DeliveryOptimizationCache) estraga o JSON final
foreach ($a in ${alvosPS()}) {
  if ($ids -notcontains $a.id) { continue }
  try {
    if ($a.id -eq 'update') { Stop-Service wuauserv,bits -Force *> $null }
    if ($a.id -eq 'entrega') { Delete-DeliveryOptimizationCache -Force *> $null }
    foreach ($c in $a.caminhos) { foreach ($p in (Resolver $c)) {
      if ($a.arquivos) { Remove-Item -LiteralPath $p -Force *> $null }
      else { Get-ChildItem -LiteralPath $p -Force | Remove-Item -Recurse -Force *> $null }
    } }
    $feito += $a.id
  } catch { $falhas += "$($a.id): $($_.Exception.Message)" }
  finally { if ($a.id -eq 'update') { Start-Service wuauserv,bits *> $null } }
}
if ($ids -contains 'lixeira') { try { Clear-RecycleBin -Force *> $null; $feito += 'lixeira' } catch { $falhas += "lixeira: $($_.Exception.Message)" } }
if ($ids -contains 'dns') { ipconfig /flushdns *> $null; $feito += 'dns' }
$mb = [math]::Max(0, [math]::Round(((Get-PSDrive C).Free - $antes)/1MB,0))
@{ ok=$true; liberadoMB=$mb; feito=$feito; falhas=$falhas } | ConvertTo-Json -Compress
`;

// ===================== MEMÓRIA RAM =====================
// Esvazia o "working set" dos processos: o Windows devolve a RAM parada para o sistema
const liberarRAM = `
Add-Type -Namespace W -Name Psapi -MemberDefinition '[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr h);'
$antes = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
$n = 0
Get-Process | Where-Object { $_.Id -gt 4 } | ForEach-Object { try { if ([W.Psapi]::EmptyWorkingSet($_.Handle)) { $n++ } } catch {} }
Start-Sleep -Milliseconds 600
$depois = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
@{ ok=$true; liberadoMB=[math]::Max(0,[math]::Round(($depois-$antes)/1024,0)); processos=$n } | ConvertTo-Json -Compress
`;

// ===================== PONTO DE RESTAURAÇÃO =====================
const pontoRestauracao = (descricao) => `
try {
  Enable-ComputerRestore -Drive "$env:SystemDrive\\"
  New-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore' -Name SystemRestorePointCreationFrequency -Value 0 -PropertyType DWord -Force | Out-Null
  Checkpoint-Computer -Description ${psParam(descricao)} -RestorePointType MODIFY_SETTINGS -ErrorAction Stop
  @{ ok=$true } | ConvertTo-Json -Compress
} catch { @{ ok=$false; erro=$_.Exception.Message } | ConvertTo-Json -Compress }
`;

const abrirRestauracao = `Start-Process rstrui.exe; @{ ok=$true } | ConvertTo-Json -Compress`;

// ===================== PROCESSOS (monitor) =====================
const PROTEGIDOS_PROC = ['Idle', 'System', 'Registry', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'svchost', 'dwm',
  'fontdrvhost', 'Memory Compression', 'MsMpEng', 'NisSrv', 'audiodg', 'sihost', 'ctfmon', 'SecurityHealthService', 'spoolsv',
  'explorer', 'conhost', 'powershell', 'Otimizador PC', 'electron', 'WmiPrvSE', 'LsaIso', 'MpDefenderCoreService'];

const processos = `
$prot = ${psParam(PROTEGIDOS_PROC)}
$cores = [Environment]::ProcessorCount
$a = @{}; Get-Process | ForEach-Object { $a[$_.Id] = $_.CPU }
Start-Sleep -Milliseconds 700
Get-Process | Group-Object ProcessName | ForEach-Object {
  $cpu = 0; foreach ($p in $_.Group) { if ($a.ContainsKey($p.Id) -and $p.CPU) { $cpu += ($p.CPU - $a[$p.Id]) } }
  $titulo = ($_.Group | Where-Object MainWindowTitle | Select-Object -First 1).MainWindowTitle
  $desc = ($_.Group | Select-Object -First 1).Description
  [pscustomobject]@{ nome=$_.Name; descricao="$desc"; janela="$titulo"; qtd=$_.Count
    ramMB=[math]::Round(($_.Group | Measure-Object WorkingSet64 -Sum).Sum/1MB,0)
    cpu=[math]::Round([math]::Max(0,$cpu)/0.7/$cores*100,1); protegido=($prot -contains $_.Name) }
} | Sort-Object ramMB -Descending | Select-Object -First 40 | ConvertTo-Json -Compress
`;

const finalizar = (nomes) => `
$prot = ${psParam(PROTEGIDOS_PROC)}
$fechados = @()
foreach ($n in ${psParam(nomes)}) { if ($prot -notcontains $n) { if (Get-Process -Name $n) { Stop-Process -Name $n -Force; $fechados += $n } } }
@{ ok=$true; fechados=$fechados } | ConvertTo-Json -Compress
`;

// ===================== MODO JOGO =====================
const ALTO_DESEMPENHO = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
const DESEMPENHO_MAXIMO = 'e9a42b02-d5df-448d-aa00-03f14749eb61'; // "Desempenho máximo" (Ultimate)

const planoAtual = `
$l = powercfg /getactivescheme
@{ guid = [regex]::Match("$l", '[0-9a-fA-F\\-]{36}').Value } | ConvertTo-Json -Compress
`;

const ativarPlano = (guid) => `
$g = ${psParam(guid)}
$lista = powercfg /list
if (-not ($lista | Select-String $g)) {
  # O plano pode existir com outro GUID (cópia) — procura pelo nome
  $nome = if ($g -eq '${DESEMPENHO_MAXIMO}') { 'Ultimate|M.ximo|Maximo' } elseif ($g -eq '${ALTO_DESEMPENHO}') { 'High performance|Alto desempenho' } else { $null }
  $linha = if ($nome) { $lista | Where-Object { $_ -match $nome } | Select-Object -First 1 }
  if ($linha) { $g = [regex]::Match("$linha", '[0-9a-fA-F\\-]{36}').Value }
  elseif ($nome) { $o = powercfg -duplicatescheme $g; $novo = [regex]::Match("$o", '[0-9a-fA-F\\-]{36}').Value; if ($novo) { $g = $novo } }
}
powercfg /setactive $g
@{ ok = ($LASTEXITCODE -eq 0) } | ConvertTo-Json -Compress
`;

// ===================== GPU (coletor contínuo) =====================
// Roda em um único PowerShell que fica aberto e imprime uma linha JSON a cada ~1,5 s.
// Uso = maior soma de utilização entre os tipos de motor (3D, Compute, Copy, Video...), como o Gerenciador de Tarefas.
const amostraGPU = `
while ($true) {
  $e = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine
  $uso = $null; $mem = $null
  if ($e) {
    $uso = ($e | Group-Object { ($_.Name -split '_engtype_')[1] } | ForEach-Object { ($_.Group | Measure-Object UtilizationPercentage -Sum).Sum } | Measure-Object -Maximum).Maximum
    $uso = [math]::Min(100, [math]::Round($uso, 0))
    $mem = (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory | Measure-Object DedicatedUsage -Maximum).Maximum
  }
  [Console]::Out.WriteLine((@{ uso = $uso; memUsadaGB = if ($mem) { [math]::Round($mem/1GB,1) } else { $null } } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 1500
}
`;

// Reabre o app pedindo permissão de Administrador (o Windows mostra o UAC)
const reiniciarAdmin = (exe, argumentos) => `
try {
  $a = ${psParam({ exe, argumentos })}
  if ($a.argumentos) { Start-Process -FilePath $a.exe -ArgumentList $a.argumentos -Verb RunAs -ErrorAction Stop }
  else { Start-Process -FilePath $a.exe -Verb RunAs -ErrorAction Stop }
  @{ ok=$true } | ConvertTo-Json -Compress
} catch { @{ ok=$false; erro=$_.Exception.Message } | ConvertTo-Json -Compress }
`;

const ehAdmin = `@{ admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } | ConvertTo-Json -Compress`;

module.exports = {
  amostraGPU, reiniciarAdmin, ehAdmin,
  status, listarApps, desinstalar, listarInicializacao, alternarInicializacao,
  ALVOS_LIMPEZA, escanearLimpeza, limpar, liberarRAM, pontoRestauracao, abrirRestauracao,
  processos, finalizar, planoAtual, ativarPlano, ALTO_DESEMPENHO, DESEMPENHO_MAXIMO
};
