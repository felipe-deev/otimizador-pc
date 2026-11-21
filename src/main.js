const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { runPS, streamPS } = require('./powershell');
const S = require('./scripts');

const NOME = 'VOLT PC Otimizador';
let win;
// O renderer só manda IDs/nomes; os comandos reais ficam aqui no processo principal (mais seguro)
let appsCache = [];
let startupCache = [];
let tamanhosLimpeza = {}; // última varredura, usada na confirmação antes de apagar
let admin = false;

const arqEstado = () => path.join(app.getPath('userData'), 'estado.json');
const lerEstado = () => { try { return JSON.parse(fs.readFileSync(arqEstado(), 'utf8')); } catch { return {}; } };
const salvarEstado = (e) => { try { fs.writeFileSync(arqEstado(), JSON.stringify({ ...lerEstado(), ...e }, null, 2)); } catch {} };

// Histórico: data, ação, resultado e — só quando existe reversão real — como desfazer
function historico(msg, extra = {}) {
  const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), data: new Date().toISOString(), msg, resultado: 'ok', ...extra };
  salvarEstado({ historico: [item, ...(lerEstado().historico || [])].slice(0, 200) });
  return item;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 940, minHeight: 640,
    backgroundColor: '#070d1a', title: NOME, autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

// Só uma janela: abrir de novo traz a que já está aberta para frente
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(async () => {
  createWindow();
  admin = !!(await runPS(S.ehAdmin).catch(() => null))?.admin;
  iniciarGPU();
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { try { gpuProc?.kill(); } catch {} });

// Registra todo erro em %APPDATA%\Otimizador PC\erros.log (para diagnosticar o que o aviso mostrou)
const logErro = (canal, info) => {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'erros.log'), `[${new Date().toLocaleString('pt-BR')}] ${canal}: ${typeof info === 'string' ? info : JSON.stringify(info)}\n`.slice(0, 4000)); } catch {}
};
const seguro = (fn, canal = 'ipc') => async (...args) => {
  try {
    const r = await fn(...args);
    if (r === null || r === undefined) logErro(canal, 'PowerShell não devolveu nada');
    else if (r.ok === false && !r.cancelado) logErro(canal, r);
    else if (r.falhas?.length) logErro(canal, { falhas: r.falhas });
    return r;
  } catch (e) { logErro(canal, e.stack || e.message); return { ok: false, erro: e.message }; }
};
const lista = (r) => (Array.isArray(r) ? r : r && typeof r === 'object' && !('ok' in r) ? [r] : []);
const precisaAdmin = (oque) => ({ ok: false, precisaAdmin: true, erro: `${oque} precisa de permissão de Administrador. Use "Reiniciar como administrador" em Ferramentas.` });

async function confirmar(mensagem, detalhe, botao = 'Continuar') {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Cancelar', botao], defaultId: 0, cancelId: 0, title: 'Confirmar', message: mensagem, detail: detalhe, noLink: true
  });
  return response === 1;
}

// Ponto de restauração antes de mudanças grandes (exige Administrador)
async function restaurar(descricao) {
  if (!admin) return precisaAdmin('Criar ponto de restauração');
  win.webContents.send('progresso', 'Criando ponto de restauração (pode levar 1–2 minutos)...');
  const r = await runPS(S.pontoRestauracao(descricao), 5 * 60 * 1000);
  historico('Ponto de restauração: ' + descricao, { resultado: r?.ok ? 'ok' : 'falha' });
  return r;
}

// ---------------- PERMISSÕES ----------------
ipcMain.handle('admin:estado', () => ({ admin }));
ipcMain.handle('admin:reiniciar', seguro(async () => {
  const exe = process.execPath;
  const args = app.isPackaged ? '' : `"${path.resolve(process.argv[1] || '.')}"`;
  app.releaseSingleInstanceLock(); // senão a nova janela (elevada) fecharia por achar que já existe uma aberta
  const r = await runPS(S.reiniciarAdmin(exe, args));
  if (r?.ok) { setTimeout(() => app.quit(), 300); return { ok: true }; }
  app.requestSingleInstanceLock();
  return { ok: false, cancelado: /cancel/i.test(r?.erro || ''), erro: r?.erro || 'Não foi possível reiniciar.' };
}, 'admin:reiniciar'));

// ---------------- STATUS / MONITOR ----------------
ipcMain.handle('status', seguro(async () => {
  const r = await runPS(S.status);
  if (r && typeof r === 'object' && 'admin' in r) admin = !!r.admin;
  return r;
}, 'status'));

// GPU: coletor contínuo (um PowerShell aberto). Sem dados → a tela mostra "Indisponível".
let gpuProc = null, gpuUltima = null, gpuReinicios = 0;
function iniciarGPU() {
  gpuProc = streamPS(S.amostraGPU, (d) => { gpuUltima = { ...d, em: Date.now() }; });
  gpuProc.on('exit', () => { if (gpuReinicios++ < 3 && !app.isQuitting) setTimeout(iniciarGPU, 3000); });
}
app.on('before-quit', () => { app.isQuitting = true; });

let cpuAnterior = os.cpus();
ipcMain.handle('monitor', () => {
  const agora = os.cpus();
  let ocioso = 0, total = 0;
  agora.forEach((c, i) => {
    const a = cpuAnterior[i]?.times || c.times;
    const t = (k) => c.times[k] - a[k];
    const tot = t('user') + t('nice') + t('sys') + t('idle') + t('irq');
    ocioso += t('idle'); total += tot;
  });
  cpuAnterior = agora;
  const gpuFresca = gpuUltima && Date.now() - gpuUltima.em < 6000 ? gpuUltima : null;
  return {
    cpu: total ? Math.round((1 - ocioso / total) * 100) : 0,
    ramTotal: os.totalmem(), ramLivre: os.freemem(),
    cpuNome: agora[0]?.model?.trim(), nucleos: agora.length,
    gpu: gpuFresca && gpuFresca.uso !== null && gpuFresca.uso !== undefined ? { uso: gpuFresca.uso, memUsadaGB: gpuFresca.memUsadaGB } : null
  };
});

ipcMain.handle('processos', seguro(async () => lista(await runPS(S.processos, 20000)), 'processos'));

ipcMain.handle('processos:finalizar', seguro(async (_e, nomes) => {
  const ok = await confirmar(
    nomes.length === 1 ? `Finalizar "${nomes[0]}"?` : `Finalizar ${nomes.length} programas?`,
    nomes.map((n) => '• ' + n).join('\n') +
      '\n\nO que acontece: o programa fecha na hora, sem perguntar. Trabalho não salvo nele é perdido. ' +
      'Se ele estiver baixando, sincronizando ou tocando algo, isso para até você abrir de novo. Nada é desinstalado.',
    'Finalizar');
  if (!ok) return { ok: false, cancelado: true };
  const r = await runPS(S.finalizar(nomes));
  if (r?.fechados?.length) historico('Programa finalizado: ' + r.fechados.join(', '));
  return r;
}, 'processos:finalizar'));

// ---------------- APPS ----------------
ipcMain.handle('apps:listar', seguro(async () => {
  appsCache = lista(await runPS(S.listarApps)).map((a, id) => ({ ...a, id }));
  return appsCache.map(({ desinstalar, ...resto }) => resto);
}, 'apps:listar'));

ipcMain.handle('apps:desinstalar', seguro(async (_e, ids, criarPonto) => {
  const alvos = ids.map((id) => appsCache[id]).filter(Boolean).filter((a) => a.nivel !== 'sistema');
  if (!alvos.length) return { ok: false, erro: 'Nada selecionado.' };
  if (!(await confirmar(`Desinstalar ${alvos.length} app(s)?`, alvos.map((a) => '• ' + a.nome).join('\n') +
    '\n\nCada desinstalador abre do jeito do próprio programa. Isso não pode ser desfeito pelo app — ' +
    (criarPonto ? 'será criado um ponto de restauração antes.' : 'sem ponto de restauração, só reinstalando.'), 'Desinstalar'))) return { ok: false, cancelado: true };
  let ponto = null;
  if (criarPonto) {
    ponto = await restaurar('VOLT PC - antes de desinstalar');
    if (!ponto?.ok && !(await confirmar('Não consegui criar o ponto de restauração.', (ponto?.erro || '') + '\n\nContinuar mesmo assim?'))) return { ok: false, cancelado: true };
  }
  const resultados = [];
  for (const [i, a] of alvos.entries()) {
    win.webContents.send('progresso', `Desinstalando ${a.nome} (${i + 1}/${alvos.length})...`);
    const r = await runPS(S.desinstalar(a), 15 * 60 * 1000);
    resultados.push({ nome: a.nome, ...(r || { ok: false }) });
    historico('Desinstalado: ' + a.nome, { resultado: r?.ok ? 'ok' : 'falha' });
  }
  return { ok: true, resultados, ponto: ponto?.ok };
}, 'apps:desinstalar'));

// ---------------- INICIALIZAÇÃO ----------------
ipcMain.handle('startup:listar', seguro(async () => {
  startupCache = lista(await runPS(S.listarInicializacao)).map((s, id) => ({ ...s, id }));
  return startupCache.map(({ aprovado, ...resto }) => ({ ...resto, precisaAdmin: /^HKLM/.test(aprovado) }));
}, 'startup:listar'));

async function alternarStartup(item, ativar) {
  if (item.essencial) return { ok: false, erro: 'Item essencial do Windows — não é alterado pelo app.' };
  if (/^HKLM/.test(item.aprovado) && !admin) return precisaAdmin('Alterar este item (vale para todos os usuários)');
  const r = await runPS(S.alternarInicializacao(item, ativar));
  return r;
}
ipcMain.handle('startup:alternar', seguro(async (_e, id, ativar) => {
  const item = startupCache[id];
  if (!item) return { ok: false, erro: 'Item não encontrado. Atualize a lista.' };
  const r = await alternarStartup(item, ativar);
  if (r?.ok) {
    item.ativo = ativar;
    const h = historico(`Inicialização ${ativar ? 'ativada' : 'desativada'}: ${item.nome}`, {
      desfazer: { tipo: 'startup', item: { nome: item.nome, chave: item.chave, aprovado: item.aprovado }, ativar: !ativar }
    });
    return { ok: true, historicoId: h.id };
  }
  return r;
}, 'startup:alternar'));

// ---------------- LIMPEZA ----------------
ipcMain.handle('limpeza:alvos', () => S.ALVOS_LIMPEZA.map(({ caminhos, ...a }) => a));
ipcMain.handle('limpeza:escanear', seguro(async () => {
  const r = await runPS(S.escanearLimpeza, 5 * 60 * 1000);
  if (r && typeof r === 'object' && r.ok !== false) tamanhosLimpeza = r;
  return r;
}, 'limpeza:escanear'));

const mbTxt = (v) => (v >= 1024 ? (v / 1024).toFixed(1).replace('.', ',') + ' GB' : (v || 0) + ' MB');
ipcMain.handle('limpar', seguro(async (_e, idsPedidos, criarPonto) => {
  const nomes = Object.fromEntries(S.ALVOS_LIMPEZA.map((a) => [a.id, a]));
  const ids = idsPedidos.filter((id) => nomes[id]);
  if (!ids.length) return { ok: false, erro: 'Nenhum item selecionado.' };
  const semPermissao = ids.filter((id) => nomes[id].admin && !admin);
  const vaiLimpar = ids.filter((id) => !semPermissao.includes(id));
  if (!vaiLimpar.length) return precisaAdmin('Os itens marcados');

  // Confirmação com a lista do que será apagado (nada é apagado sem isso)
  const total = vaiLimpar.reduce((s, id) => s + (tamanhosLimpeza[id] || 0), 0);
  const detalhe = vaiLimpar.map((id) => `• ${nomes[id].nome}${id === 'dns' ? '' : ' — ' + mbTxt(tamanhosLimpeza[id])}`).join('\n') +
    (semPermissao.length ? `\n\nPulados (precisam de Administrador): ${semPermissao.map((id) => nomes[id].nome).join(', ')}` : '') +
    '\n\nSó são apagados temporários e caches. Documentos, fotos, senhas e histórico dos navegadores não são tocados.' +
    (vaiLimpar.includes('lixeira') ? '\nA Lixeira será esvaziada — isso é definitivo.' : '') +
    '\nArquivos apagados não podem ser recuperados pelo app.';
  if (!(await confirmar(`Apagar ${vaiLimpar.length === 1 ? '1 item' : vaiLimpar.length + ' itens'}${total ? ` (~${mbTxt(total)})` : ''}?`, detalhe, 'Limpar'))) return { ok: false, cancelado: true };

  if (criarPonto) await restaurar('VOLT PC - antes da limpeza');
  // Um item por vez, avisando a tela, para não parecer travado em itens demorados (cache de programação, temp)
  const r = { ok: true, liberadoMB: 0, feito: [], falhas: semPermissao.map((id) => `${nomes[id].nome}: precisa de Administrador`) };
  for (const [i, id] of vaiLimpar.entries()) {
    win.webContents.send('progresso', `Limpando ${nomes[id].nome} (${i + 1}/${vaiLimpar.length})...\nItens com muitos arquivos podem levar alguns minutos.`);
    const p = await runPS(S.limpar([id]), 15 * 60 * 1000);
    if (p?.ok) { r.liberadoMB += p.liberadoMB || 0; r.feito.push(...[].concat(p.feito || [])); r.falhas.push(...[].concat(p.falhas || [])); }
    else r.falhas.push(`${nomes[id].nome}: ${p?.erro || 'sem resposta'}`);
  }
  if (!r.feito.length) return { ok: false, erro: r.falhas.join('; ') || 'Nada foi limpo.' };
  historico(`Limpeza: ${mbTxt(r.liberadoMB)} liberados (${r.feito.length} itens)`, { resultado: r.falhas.length ? 'parcial' : 'ok' });
  return r;
}, 'limpar'));

ipcMain.handle('ram', seguro(async () => {
  const r = await runPS(S.liberarRAM, 60000);
  if (r?.ok) historico(`RAM liberada: ${mbTxt(r.liberadoMB)}`);
  return r;
}, 'ram'));

// ---------------- ANÁLISE ----------------
ipcMain.handle('analise:ultima', () => lerEstado().ultimaAnalise || null);
ipcMain.handle('analise:salvar', (_e, resumo) => {
  const a = { data: new Date().toISOString(), ...resumo };
  salvarEstado({ ultimaAnalise: a });
  return a;
});

// ---------------- RESTAURAÇÃO / HISTÓRICO ----------------
ipcMain.handle('restauracao:criar', seguro(() => restaurar('VOLT PC - manual'), 'restauracao:criar'));
ipcMain.handle('restauracao:abrir', seguro(() => runPS(S.abrirRestauracao), 'restauracao:abrir'));
ipcMain.handle('historico', () => (lerEstado().historico || []).map((h, i) => ({ id: h.id || 'antigo' + i, resultado: 'ok', ...h, podeDesfazer: !!h.desfazer && !h.desfeito })));

ipcMain.handle('historico:desfazer', seguro(async (_e, id) => {
  const hist = lerEstado().historico || [];
  const h = hist.find((x) => x.id === id);
  if (!h?.desfazer || h.desfeito) return { ok: false, erro: 'Esta ação não pode ser desfeita.' };
  let r;
  if (h.desfazer.tipo === 'startup') {
    r = await alternarStartup({ ...h.desfazer.item, essencial: false }, h.desfazer.ativar);
    const c = startupCache.find((s) => s.nome === h.desfazer.item.nome && s.aprovado === h.desfazer.item.aprovado);
    if (r?.ok && c) c.ativo = h.desfazer.ativar;
  } else if (h.desfazer.tipo === 'jogo') {
    r = await desativarJogo();
  } else return { ok: false, erro: 'Tipo de ação desconhecido.' };
  if (!r?.ok) return r;
  h.desfeito = true;
  salvarEstado({ historico: hist });
  historico('Desfeito: ' + h.msg);
  return { ok: true };
}, 'historico:desfazer'));

// ---------------- MODO JOGO ----------------
ipcMain.handle('jogo:estado', () => ({ ativo: !!lerEstado().jogo, ...lerEstado().jogo }));

ipcMain.handle('jogo:ativar', seguro(async (_e, opcoes) => {
  const resumo = ['Plano de energia: ' + (opcoes.planoMaximo ? '"Desempenho máximo"' : '"Alto desempenho"') + ' (volta ao atual ao desativar)'];
  if (opcoes.fechar?.length) resumo.push('Fechar: ' + opcoes.fechar.join(', ') + ' (trabalho não salvo neles é perdido)');
  if (opcoes.ram) resumo.push('Liberar memória RAM parada');
  if (!(await confirmar('Ativar Modo Jogo?', 'O que será alterado:\n' + resumo.map((x) => '• ' + x).join('\n'), 'Ativar'))) return { ok: false, cancelado: true };
  const passos = [];
  const anterior = await runPS(S.planoAtual);
  const plano = opcoes.planoMaximo ? S.DESEMPENHO_MAXIMO : S.ALTO_DESEMPENHO;
  win.webContents.send('progresso', 'Ativando desempenho máximo...');
  const p = await runPS(S.ativarPlano(plano));
  passos.push(p?.ok ? 'Plano de energia no máximo' : 'Plano de energia não foi alterado');
  if (opcoes.fechar?.length) {
    win.webContents.send('progresso', 'Fechando programas em segundo plano...');
    const f = await runPS(S.finalizar(opcoes.fechar));
    if (f?.fechados?.length) passos.push('Fechados: ' + f.fechados.join(', '));
  }
  if (opcoes.ram) {
    win.webContents.send('progresso', 'Liberando memória RAM...');
    const ram = (await runPS(S.liberarRAM, 60000))?.liberadoMB || 0;
    passos.push(`RAM liberada: ${mbTxt(ram)}`);
  }
  salvarEstado({ jogo: { planoAnterior: anterior?.guid, desde: new Date().toISOString(), fechar: opcoes.fechar } });
  // Desfazer restaura só o plano de energia — programas fechados não são reabertos
  historico('Modo Jogo ativado', { desfazer: { tipo: 'jogo' } });
  return { ok: true, passos };
}, 'jogo:ativar'));

async function desativarJogo() {
  const j = lerEstado().jogo;
  if (!j) return { ok: true };
  if (j.planoAnterior) await runPS(S.ativarPlano(j.planoAnterior));
  salvarEstado({ jogo: null });
  const hist = lerEstado().historico || [];
  hist.filter((h) => h.desfazer?.tipo === 'jogo' && !h.desfeito).forEach((h) => (h.desfeito = true));
  salvarEstado({ historico: hist });
  return { ok: true };
}
ipcMain.handle('jogo:desativar', seguro(async () => {
  const r = await desativarJogo();
  historico('Modo Jogo desativado (plano de energia restaurado)');
  return r;
}, 'jogo:desativar'));

// ---------------- ATALHOS DO WINDOWS ----------------
ipcMain.handle('abrir:defender', () => shell.openExternal('windowsdefender://threat'));
