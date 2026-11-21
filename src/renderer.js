const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
// `api` já é global (window.api, exposto pelo preload) — redeclarar com const quebra o script inteiro
let apps = [], startup = [], alvos = [], tamanhos = {}, procs = [], statusPC = null, admin = false, categorias = [];
const selApps = new Set(), selProc = new Set();

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mb = (v) => (v >= 1024 ? (v / 1024).toFixed(1).replace('.', ',') + ' GB' : Math.round(v || 0) + ' MB');
const gb = (v) => (v ?? 0).toFixed(1).replace('.', ',');
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const ler = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch { return padrao; } };
const dataHora = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const pl = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const icone = (id) => `<svg><use href="#i-${id}"/></svg>`;

function carregando(on, msg = 'Analisando...') { $('#carregando').classList.toggle('escondido', !on); $('#msgCarregando').textContent = msg; }
// Aviso no canto; `acao` = { texto, fn } mostra um botão (ex.: Desfazer)
function toast(msg, erro = false, acao = null) {
  const t = $('#toast'); $('#toastMsg').textContent = msg; t.className = 'mostrar' + (erro ? ' erro' : '');
  const b = $('#toastAcao'); b.classList.toggle('escondido', !acao);
  if (acao) { b.textContent = acao.texto; b.onclick = () => { t.className = ''; acao.fn(); }; }
  clearTimeout(t._t); t._t = setTimeout(() => (t.className = ''), erro || acao ? 15000 : 6000);
}
api.onProgresso((m) => ($('#msgCarregando').textContent = m));
// Mensagem padrão para resultados de ações (cancelado não mostra nada)
function resultado(r, sucesso) {
  if (r?.cancelado) return false;
  if (!r?.ok) { toast((r?.erro || 'Não foi possível concluir.') , true, r?.precisaAdmin && !admin ? { texto: 'Reiniciar como admin', fn: reiniciarAdmin } : null); return false; }
  if (sucesso) toast(sucesso);
  return true;
}

// =================== NAVEGAÇÃO ===================
let abaAtual = 'inicio';
$$('.tab').forEach((b) => (b.onclick = () => {
  $$('.tab').forEach((x) => x.classList.remove('ativo')); b.classList.add('ativo');
  $$('.pagina').forEach((p) => p.classList.remove('ativa')); $('#' + b.dataset.tab).classList.add('ativa');
  abaAtual = b.dataset.tab; $('#trilhaPagina').textContent = b.title; $('main').scrollTop = 0;
  if (abaAtual === 'desempenho') carregarProcessos();
  if (abaAtual === 'relatorios') carregarRelatorios();
  if (abaAtual === 'ferramentas') carregarFerramentas();
  desenharTudo();
}));
const irPara = (aba) => $(`[data-tab="${aba}"]`).click();

// =================== PERMISSÕES ===================
async function reiniciarAdmin() {
  const r = await api.reiniciarAdmin();
  if (r?.cancelado) return toast('Permissão de Administrador não concedida. O app continua no modo padrão.');
  if (!r?.ok) toast('Não foi possível reiniciar: ' + (r?.erro || ''), true);
}
function mostrarAdmin() {
  const c = $('#chipAdmin'); c.classList.remove('escondido');
  c.className = 'chip ' + (admin ? 'ok' : 'alerta');
  c.innerHTML = icone('chave') + (admin ? 'Administrador' : 'Modo padrão');
  c.onclick = () => irPara('ferramentas');
  $('#txtAdmin').textContent = admin
    ? 'O app está rodando como Administrador: todas as funções estão liberadas.'
    : 'Rodando no modo padrão (mais seguro). Limpar pastas do Windows, criar ponto de restauração e alterar itens de todos os usuários precisam de Administrador.';
  $('#btnAdmin').disabled = admin; $('#btnAdmin').textContent = admin ? 'Já está como administrador' : 'Reiniciar como administrador';
}
$('#btnAdmin').onclick = reiniciarAdmin;

// =================== STATUS ===================
async function carregarStatus() {
  const s = await api.status();
  if (!s || s.ok === false) { toast('Não consegui ler o status do PC: ' + (s?.erro || ''), true); return; }
  statusPC = s; admin = !!s.admin; mostrarAdmin();
  const d = (s.discos || []).find((x) => x.disco === 'C:') || s.discos?.[0];
  if (d) {
    const usado = Math.round((1 - d.livreGB / d.totalGB) * 100);
    $('#mDisco').textContent = usado + '%'; $('#mDiscoNome').textContent = d.disco;
    $('#mDiscoBarra').style.width = usado + '%';
    $('#mDiscoBarra').style.background = usado > 90 ? 'var(--vermelho)' : usado > 80 ? 'var(--amarelo)' : '';
    $('#mDiscoSub').textContent = `${gb(d.totalGB - d.livreGB)} de ${gb(d.totalGB)} GB · ${gb(d.livreGB)} GB livres`;
    $('#mDiscoSub').title = (s.discos || []).map((x) => `${x.disco} ${gb(x.livreGB)} GB livres de ${gb(x.totalGB)} GB`).join('\n');
  } else { $('#mDisco').textContent = 'Indisponível'; $('#mDisco').classList.add('indisp'); }
  $('#infoSistema').textContent = `${s.windows || ''} · ligado há ${s.ligadoHa} h`;
  // Proteção do Windows (dado real do Defender; se não houver, o chip some)
  const c = $('#chipDefender');
  if (s.defender) {
    const ok = s.defender.tempoReal && s.defender.antivirus;
    c.className = 'chip ' + (ok ? 'ok' : 'ruim'); c.innerHTML = icone('escudo') + (ok ? 'PC protegido' : 'Proteção desligada');
    c.onclick = () => api.abrirDefender();
    $('#txtDefender').textContent = ok ? 'Microsoft Defender ativo, com proteção em tempo real ligada.' : 'A proteção em tempo real do Microsoft Defender está desligada. Confira na Segurança do Windows.';
  } else { c.classList.add('escondido'); $('#txtDefender').textContent = 'Status do Microsoft Defender indisponível (outro antivírus pode estar em uso).'; }
}

// =================== MONITOR EM TEMPO REAL ===================
const MAX = 300; const hist = { cpu: [], ram: [], gpu: [] };
let ultimo = null; const inicio = Date.now();
async function tickMonitor() {
  const m = await api.monitor(); ultimo = m;
  const ramPct = Math.round((1 - m.ramLivre / m.ramTotal) * 100);
  hist.cpu.push(m.cpu); hist.ram.push(ramPct); hist.gpu.push(m.gpu ? m.gpu.uso : null);
  for (const k in hist) if (hist[k].length > MAX) hist[k].shift();
  const usadaGB = (m.ramTotal - m.ramLivre) / 1073741824, totalGB = m.ramTotal / 1073741824;
  const gpuTxt = m.gpu ? m.gpu.uso + '%' : null;
  const gpuEsperando = !m.gpu && Date.now() - inicio < 12000;
  // Barra lateral
  $('#miniCpu').textContent = m.cpu + '%'; $('#miniRam').textContent = ramPct + '%'; $('#miniGpu').textContent = gpuTxt || '—';
  // Início
  $('#mCpu').textContent = m.cpu + '%'; $('#mCpuSub').textContent = `${m.cpuNome || 'Processador'} · ${m.nucleos} threads`;
  $('#mRam').textContent = ramPct + '%'; $('#mRamSub').textContent = `${gb(usadaGB)} GB de ${gb(totalGB)} GB em uso`;
  const g = $('#mGpu'); g.classList.toggle('indisp', !m.gpu);
  g.textContent = gpuTxt || (gpuEsperando ? 'Lendo...' : 'Indisponível');
  const gpuNome = statusPC?.gpu?.nome;
  $('#mGpuSub').textContent = m.gpu
    ? (m.gpu.memUsadaGB != null && statusPC?.gpu?.vramGB ? `${gb(m.gpu.memUsadaGB)} GB de ${gb(statusPC.gpu.vramGB)} GB · ` : '') + (gpuNome || '')
    : (gpuEsperando ? 'Aguardando leitura...' : 'O Windows não informou o uso da placa de vídeo.');
  $('#legCpu').textContent = `(${m.cpu}%)`; $('#legRam').textContent = `(${ramPct}%)`; $('#legGpu').textContent = gpuTxt ? `(${gpuTxt})` : '(indisponível)';
  // Desempenho
  $('#cpuValor').textContent = m.cpu + '%'; $('#cpuNome').textContent = `${m.cpuNome || ''} · ${m.nucleos} threads`;
  $('#ramValor').textContent = ramPct + '%'; $('#ramDetalhe').textContent = `${gb(usadaGB)} GB em uso de ${gb(totalGB)} GB`;
  const gv = $('#gpuValor'); gv.classList.toggle('indisp', !m.gpu); gv.textContent = gpuTxt || (gpuEsperando ? 'Lendo...' : 'Indisponível');
  $('#gpuDetalhe').textContent = m.gpu ? [gpuNome, m.gpu.memUsadaGB != null && statusPC?.gpu?.vramGB ? `memória ${gb(m.gpu.memUsadaGB)} de ${gb(statusPC.gpu.vramGB)} GB` : ''].filter(Boolean).join(' · ') : '';
  desenharTudo();
}
setInterval(tickMonitor, 1000);

// Gráficos (canvas): séries de 0–100%; valores null (dado indisponível) interrompem a linha
function grafico(canvas, series, janela, eixos) {
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const c = canvas.getContext('2d'); c.scale(dpr, dpr); c.clearRect(0, 0, w, h);
  const esq = eixos ? 38 : 0, base = eixos ? 20 : 2, topo = eixos ? 8 : 2;
  const aw = w - esq, ah = h - base - topo;
  const x = (i, n) => esq + aw - (n - 1 - i) * (aw / (janela - 1)), y = (v) => topo + ah - (v / 100) * ah;
  if (eixos) {
    c.font = '11px Segoe UI'; c.fillStyle = '#8fa0bb'; c.strokeStyle = 'rgba(143,160,187,.12)'; c.lineWidth = 1;
    for (let p = 0; p <= 100; p += 20) { c.beginPath(); c.moveTo(esq, y(p)); c.lineTo(w, y(p)); c.stroke(); c.fillText(p + '%', 0, y(p) + 4); }
    const passos = 6;
    for (let k = 0; k <= passos; k++) {
      const seg = Math.round(janela - (janela / passos) * k), px = esq + (aw / passos) * k;
      c.beginPath(); c.moveTo(px, topo); c.lineTo(px, topo + ah); c.stroke();
      const t = seg >= 60 && seg % 60 === 0 ? seg / 60 + 'min' : seg + 's';
      c.fillText(t, Math.min(Math.max(px - 10, esq), w - 26), h - 4);
    }
  }
  for (const s of series) {
    const d = s.dados.slice(-janela); if (d.filter((v) => v != null).length < 2) continue;
    c.beginPath(); let aberto = false;
    d.forEach((v, i) => { if (v == null) { aberto = false; return; } aberto ? c.lineTo(x(i, d.length), y(v)) : c.moveTo(x(i, d.length), y(v)); aberto = true; });
    c.strokeStyle = s.cor; c.lineWidth = eixos ? 2 : 1.8; c.shadowColor = s.cor; c.shadowBlur = 6; c.stroke(); c.shadowBlur = 0;
    if (s.preencher) {
      const ult = d.length - 1; const pri = d.findIndex((v) => v != null);
      c.lineTo(x(ult, d.length), topo + ah); c.lineTo(x(pri, d.length), topo + ah); c.closePath();
      const gr = c.createLinearGradient(0, topo, 0, topo + ah); gr.addColorStop(0, s.cor + '40'); gr.addColorStop(1, s.cor + '00');
      c.fillStyle = gr; c.fill();
    }
  }
}
const CORES = { cpu: '#2f7bff', ram: '#22c55e', gpu: '#a855f7' };
function desenharTudo() {
  if (abaAtual === 'inicio') {
    grafico($('#sparkCpu'), [{ dados: hist.cpu, cor: '#22d3ee', preencher: true }], 40, false);
    grafico($('#sparkRam'), [{ dados: hist.ram, cor: '#22d3ee', preencher: true }], 40, false);
    grafico($('#sparkGpu'), [{ dados: hist.gpu, cor: '#22d3ee', preencher: true }], 40, false);
    grafico($('#graficoVivo'), [{ dados: hist.cpu, cor: CORES.cpu, preencher: true }, { dados: hist.ram, cor: CORES.ram }, { dados: hist.gpu, cor: CORES.gpu }], +$('#janelaGrafico').value, true);
  } else if (abaAtual === 'desempenho') {
    grafico($('#graficoDesempenho'), [{ dados: hist.cpu, cor: CORES.cpu, preencher: true }, { dados: hist.ram, cor: CORES.ram }, { dados: hist.gpu, cor: CORES.gpu }], 120, true);
  }
}
$('#janelaGrafico').onchange = () => { guardar('janelaGrafico', $('#janelaGrafico').value); desenharTudo(); };
$('#janelaGrafico').value = ler('janelaGrafico', '60');
window.addEventListener('resize', desenharTudo);

// =================== PROCESSOS ===================
let buscandoProc = false, ordem = ler('ordemProc', { campo: 'ramMB', dir: 'desc' });
async function carregarProcessos() {
  if (buscandoProc) return; buscandoProc = true;
  const r = await api.processos(); buscandoProc = false;
  if (!Array.isArray(r)) return;
  procs = r; renderProcessos(); if (abaAtual === 'ferramentas') renderJogoProcessos();
}
setInterval(() => abaAtual === 'desempenho' && carregarProcessos(), 4000);
function renderProcessos() {
  const busca = $('#buscaProc').value.trim().toLowerCase();
  const f = ordem.dir === 'asc' ? 1 : -1;
  const lista = procs
    .filter((p) => !busca || p.nome.toLowerCase().includes(busca) || (p.descricao || '').toLowerCase().includes(busca) || (p.janela || '').toLowerCase().includes(busca))
    .sort((a, b) => (ordem.campo === 'nome' ? (a.descricao || a.nome).localeCompare(b.descricao || b.nome, 'pt-BR') * f : ((a[ordem.campo] || 0) - (b[ordem.campo] || 0)) * f));
  $$('th.ordena').forEach((th) => th.classList.toggle('asc', th.dataset.ord === ordem.campo && ordem.dir === 'asc'));
  $$('th.ordena').forEach((th) => th.classList.toggle('desc', th.dataset.ord === ordem.campo && ordem.dir === 'desc'));
  $('#listaProc').innerHTML = lista.length ? lista.map((p) => `
    <tr class="${p.protegido ? 'protegido' : ''}">
      <td><input type="checkbox" data-nome="${esc(p.nome)}" ${selProc.has(p.nome) ? 'checked' : ''} ${p.protegido ? 'disabled title="Processo do sistema — bloqueado"' : ''}></td>
      <td class="nome"><b>${esc(p.descricao || p.nome)}</b><span>${esc(p.nome)}${p.qtd > 1 ? ` · ${p.qtd} processos` : ''}${p.protegido ? ' · sistema' : ''}</span></td>
      <td>${mb(p.ramMB)}</td>
      <td><span class="barra-cpu"><i style="width:${Math.min(100, p.cpu)}%"></i></span>${String(p.cpu).replace('.', ',')}%</td>
    </tr>`).join('') : `<tr><td colspan="4" class="vazio">${busca ? 'Nenhum processo com esse nome.' : 'Carregando...'}</td></tr>`;
  $$('#listaProc input').forEach((c) => (c.onchange = () => { c.checked ? selProc.add(c.dataset.nome) : selProc.delete(c.dataset.nome); botaoFinalizar(); }));
  botaoFinalizar();
}
$$('th.ordena').forEach((th) => (th.onclick = () => {
  ordem = { campo: th.dataset.ord, dir: ordem.campo === th.dataset.ord && ordem.dir === 'desc' ? 'asc' : 'desc' };
  if (th.dataset.ord === 'nome' && ordem.campo !== th.dataset.ord) ordem.dir = 'asc';
  guardar('ordemProc', ordem); renderProcessos();
}));
$('#buscaProc').oninput = renderProcessos;
function botaoFinalizar() { $('#btnFinalizar').disabled = !selProc.size; $('#btnFinalizar').textContent = `Finalizar (${selProc.size})`; }
$('#btnFinalizar').onclick = async () => {
  const r = await api.finalizar([...selProc]);
  if (r?.cancelado) return;
  toast(r?.fechados?.length ? 'Finalizado: ' + r.fechados.join(', ') : 'Nada foi finalizado.', !r?.fechados?.length);
  selProc.clear(); carregarProcessos();
};

async function liberarRAM() {
  carregando(true, 'Liberando memória RAM...');
  const r = await api.liberarRAM(); carregando(false);
  resultado(r, `RAM liberada: ~${mb(r?.liberadoMB)} (${r?.processos} programas). Nenhum programa foi fechado.`);
}
$('#btnRamMonitor').onclick = liberarRAM;
$('#btnRam').onclick = liberarRAM;

// =================== APLICATIVOS ===================
async function carregarApps() {
  const r = await api.listarApps();
  if (!Array.isArray(r)) { toast('Erro ao listar apps: ' + (r?.erro || ''), true); return; }
  apps = r; selApps.clear();
  const remover = apps.filter((a) => a.nivel === 'remover').length;
  $('#badgeApps').textContent = remover || '';
  renderApps();
}
function renderApps() {
  const busca = $('#busca').value.toLowerCase(), filtro = $('#filtro').value;
  const ordemNivel = { remover: 0, revisar: 1, ok: 2, sistema: 3 };
  const lista = apps
    .filter((a) => filtro === 'todos' || a.nivel === 'remover' || a.nivel === 'revisar')
    .filter((a) => !busca || a.nome.toLowerCase().includes(busca) || (a.fabricante || '').toLowerCase().includes(busca))
    .sort((a, b) => ordemNivel[a.nivel] - ordemNivel[b.nivel] || b.tamanhoMB - a.tamanhoMB);
  $('#listaApps').innerHTML = lista.length ? lista.map((a) => `
    <tr>
      <td><input type="checkbox" data-id="${a.id}" ${selApps.has(a.id) ? 'checked' : ''} ${a.nivel === 'sistema' ? 'disabled' : ''}></td>
      <td class="nome"><b>${esc(a.nome)}</b><span>${a.tipo === 'store' ? 'Microsoft Store' : 'Programa'}${a.versao ? ' · v' + esc(a.versao) : ''}${a.instalado ? ' · ' + esc(a.instalado) : ''}</span>
        <div class="local">${a.local
          ? `<button class="pequeno link" data-local="${a.id}" title="Abrir esta pasta no Explorador">${icone('pasta')}Abrir local</button><span class="caminho" title="${esc(a.local)}">${esc(a.local)}</span>`
          : '<span class="caminho">Pasta não informada pelo Windows</span>'}</div></td>
      <td>${esc(a.fabricante)}</td>
      <td>${a.tamanhoMB ? mb(a.tamanhoMB) : '—'}</td>
      <td class="motivo">${a.nivel !== 'ok' ? `<b class="tag ${a.nivel}">${{ remover: 'Remover', revisar: 'Revisar', sistema: 'Sistema' }[a.nivel]}</b>` : ''}${esc(a.motivos)}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="vazio">Nada por aqui. Nenhum app sugerido para remover neste filtro.</td></tr>';
  $$('#listaApps input').forEach((c) => (c.onchange = () => { const id = +c.dataset.id; c.checked ? selApps.add(id) : selApps.delete(id); botaoDesinstalar(); }));
  $$('[data-local]').forEach((b) => (b.onclick = async () => { const r = await api.abrirLocalApp(+b.dataset.local); if (!r?.ok) toast(r?.erro || 'Não foi possível abrir a pasta.', true); }));
  botaoDesinstalar();
}
function botaoDesinstalar() { $('#btnDesinstalar').disabled = !selApps.size; $('#btnDesinstalar').textContent = `Desinstalar (${selApps.size})`; }
$('#busca').oninput = renderApps;
$('#filtro').onchange = renderApps;
$('#btnDesinstalar').onclick = async () => {
  carregando(true, 'Preparando...');
  const r = await api.desinstalar([...selApps], $('#pontoApps').checked);
  carregando(false);
  if (r?.cancelado) return;
  if (!r?.ok) return toast(r?.erro || 'Erro ao desinstalar', true);
  const falhas = r.resultados.filter((x) => !x.ok), pend = r.resultados.filter((x) => x.ok && x.pendente);
  const feitos = r.resultados.length - falhas.length - pend.length;
  toast((feitos ? `${pl(feitos, 'app removido', 'apps removidos')}.` : '') + (r.ponto ? ' Ponto de restauração criado.' : '') +
    (pend.length ? `\nConfirme na janela do launcher: ${pend.map((p) => `${p.nome} (${p.launcher})`).join(', ')}. Depois clique em Atualizar a lista.` : '') +
    (falhas.length ? `\nFalharam: ${falhas.map((f) => f.nome).join(', ')}` : ''), falhas.length > 0);
  carregando(true, 'Atualizando lista...'); await carregarApps(); carregando(false); montarAnalise(false);
};

// =================== INICIALIZAÇÃO ===================
async function carregarStartup() {
  const r = await api.listarStartup();
  if (!Array.isArray(r)) { toast('Erro ao ler inicialização: ' + (r?.erro || ''), true); return; }
  startup = r; renderStartup();
}
function renderStartup() {
  const ativos = startup.filter((s) => s.ativo && !s.essencial).length;
  $('#badgeStartup').textContent = ativos > 5 ? ativos : '';
  $('#listaStartup').innerHTML = startup.length ? startup.map((s) => {
    const bloqueado = s.essencial || (s.precisaAdmin && !admin);
    const motivo = s.essencial ? 'Essencial do Windows — não é alterado' : s.precisaAdmin && !admin ? 'Vale para todos os usuários — precisa de Administrador' : '';
    return `<div class="item">
      <div class="info"><b>${esc(s.nome)}${s.essencial ? '<span class="tag sistema">Essencial</span>' : ''}</b>
        <span>${esc(s.editor || 'Editor desconhecido')} · ${esc(s.arquivo || '')} · ${s.origem === 'HKCU' ? 'Só você' : s.origem === 'Pasta Inicializar' ? 'Pasta Inicializar' : 'Todos os usuários'}${motivo ? ' · ' + motivo : ''}</span></div>
      <span class="estado">${s.ativo ? 'Ativado' : 'Desativado'}</span>
      <label class="switch" title="${esc(motivo || (s.ativo ? 'Desativar' : 'Ativar'))}"><input type="checkbox" data-id="${s.id}" ${s.ativo ? 'checked' : ''} ${bloqueado ? 'disabled' : ''}><i></i></label>
    </div>`;
  }).join('') : '<p class="vazio">Nenhum programa abrindo com o Windows.</p>';
  $$('#listaStartup input').forEach((c) => (c.onchange = async () => {
    const item = startup.find((s) => s.id === +c.dataset.id), ativar = c.checked;
    const r = await api.alternarStartup(item.id, ativar);
    if (!r?.ok) { c.checked = !ativar; return resultado(r); }
    item.ativo = ativar; renderStartup(); montarAnalise(false);
    toast(ativar ? `${item.nome} vai abrir com o Windows de novo.` : `${item.nome} não abre mais com o Windows (vale a partir do próximo boot).`, false, {
      texto: 'Desfazer', fn: async () => { const d = await api.desfazer(r.historicoId); if (resultado(d, 'Desfeito.')) { await carregarStartup(); montarAnalise(false); } }
    });
  }));
}
$('#btnAtualizarStartup').onclick = async () => { await carregarStartup(); montarAnalise(false); };

// =================== LIMPEZA ===================
async function carregarAlvos() {
  alvos = await api.alvosLimpeza();
  const salvos = ler('limpezaSel', null);
  $('#opcoesLimpeza').innerHTML = alvos.map((a) => `
    <label><input type="checkbox" data-op="${a.id}" ${(salvos ? salvos.includes(a.id) : a.padrao) ? 'checked' : ''}>
      <span class="txt"><b>${esc(a.nome)}${a.admin ? '<i class="adm">admin</i>' : ''}</b>${esc(a.desc)}</span>
      <span class="tam" id="tam-${a.id}">...</span></label>`).join('');
  $$('[data-op]').forEach((c) => (c.onchange = () => { guardar('limpezaSel', selecionadosLimpeza()); totalLimpeza(); }));
}
const selecionadosLimpeza = () => [...$$('[data-op]')].filter((c) => c.checked).map((c) => c.dataset.op);
async function escanear() {
  alvos.forEach((a) => ($('#tam-' + a.id).textContent = '...'));
  const r = await api.escanearLimpeza();
  if (!r || r.ok === false) { toast('Erro ao escanear: ' + (r?.erro || ''), true); return; }
  tamanhos = r;
  alvos.forEach((a) => {
    const el = $('#tam-' + a.id), v = r[a.id] || 0;
    el.textContent = a.id === 'dns' ? '' : v ? mb(v) : 'vazio'; el.classList.toggle('zero', !v);
  });
  const total = lixoSeguro();
  $('#badgeLixo').textContent = total > 1024 ? Math.round(total / 1024) + 'G' : '';
  totalLimpeza();
}
// "Lixo" da análise = só as categorias marcadas por padrão (seguras); caches opcionais não entram na nota
const lixoSeguro = () => alvos.filter((a) => a.padrao).reduce((s, a) => s + (tamanhos[a.id] || 0), 0);
function totalLimpeza() { $('#totalLimpeza').textContent = mb(selecionadosLimpeza().reduce((s, id) => s + (tamanhos[id] || 0), 0)); }
$('#btnEscanear').onclick = async () => { await escanear(); montarAnalise(false); };

async function limpar(ids) {
  carregando(true, 'Aguardando confirmação...');
  const r = await api.limpar(ids, $('#pontoLimpeza').checked);
  carregando(false);
  if (r?.cancelado) return r;
  if (!r?.ok) { resultado(r); return r; }
  const falhas = [].concat(r.falhas || []);
  toast(`Pronto! Liberado ~${mb(r.liberadoMB)} no disco C:\n(${[].concat(r.feito || []).length} itens limpos)` + (falhas.length ? `\nNão deu para limpar: ${falhas.join('; ')}` : ''), falhas.length > 0);
  await Promise.all([carregarStatus(), escanear()]); montarAnalise(false);
  return r;
}
$('#btnLimpar').onclick = () => limpar(selecionadosLimpeza());

// =================== ANÁLISE ===================
const NIVEL = { ok: 0, alerta: 1, ruim: 2 };
function montarCategorias() {
  const s = statusPC; const cats = [];
  if (Object.keys(tamanhos).length) {
    const lixo = lixoSeguro(), n = alvos.filter((a) => a.padrao && tamanhos[a.id] > 0).length;
    cats.push({ id: 'limpeza', titulo: 'Arquivos temporários', icone: 'lixo', nivel: lixo > 5120 ? 'ruim' : lixo > 1024 ? 'alerta' : 'ok',
      impacto: lixo > 5120 ? 'alto' : lixo > 1024 ? 'medio' : lixo > 100 ? 'baixo' : 'nenhum',
      achado: lixo > 100 ? `${mb(lixo)} disponíveis para liberação em ${pl(n, 'categoria', 'categorias')}.` : 'Pouco lixo acumulado.',
      muda: 'Apaga só as categorias que você marcar, depois de confirmar. Documentos, fotos e senhas não são tocados.', ir: 'limpeza', botao: 'Revisar' });
  }
  if (startup.length) {
    const ativos = startup.filter((x) => x.ativo && !x.essencial).length;
    cats.push({ id: 'startup', titulo: 'Inicialização', icone: 'power', nivel: ativos > 8 ? 'ruim' : ativos > 5 ? 'alerta' : 'ok',
      impacto: ativos > 8 ? 'alto' : ativos > 5 ? 'medio' : ativos > 3 ? 'baixo' : 'nenhum',
      achado: ativos ? `${pl(ativos, 'programa abre', 'programas abrem')} junto com o Windows.` : 'Nenhum programa abre junto com o Windows.',
      muda: 'O programa escolhido deixa de abrir sozinho. Nada é desinstalado e dá para reativar quando quiser.', ir: 'startup', botao: 'Gerenciar' });
  }
  if (apps.length) {
    const rem = apps.filter((a) => a.nivel === 'remover').length, rev = apps.filter((a) => a.nivel === 'revisar').length;
    cats.push({ id: 'apps', titulo: 'Aplicativos', icone: 'apps', nivel: rem ? 'alerta' : 'ok', impacto: rem >= 3 ? 'medio' : rem ? 'baixo' : 'nenhum',
      achado: rem ? `${pl(rem, 'app sugerido', 'apps sugeridos')} para remover${rev ? ` e ${rev} para revisar` : ''}.` : `Nenhum bloatware encontrado${rev ? ` (${rev} para revisar)` : ''}.`,
      muda: 'Só desinstala o que você marcar e confirmar. Desinstalação não pode ser desfeita pelo app.', ir: 'apps', botao: 'Revisar' });
  }
  if (s) {
    const d = (s.discos || []).find((x) => x.disco === 'C:') || s.discos?.[0];
    if (d) {
      const livre = d.livreGB / d.totalGB;
      cats.push({ id: 'disco', titulo: 'Armazenamento', icone: 'disco', nivel: livre < 0.1 ? 'ruim' : livre < 0.2 ? 'alerta' : 'ok', impacto: livre < 0.1 ? 'alto' : livre < 0.2 ? 'medio' : 'nenhum',
        achado: `${gb(d.livreGB)} GB livres de ${gb(d.totalGB)} GB no ${d.disco} (${Math.round(livre * 100)}%).`,
        muda: 'Pouco espaço deixa o Windows lento. Libere com a Limpeza ou removendo apps grandes.', ir: 'limpeza', botao: 'Liberar espaço' });
    }
    const ramLivre = s.ramLivreGB / s.ramTotalGB;
    cats.push({ id: 'ram', titulo: 'Memória', icone: 'ram', nivel: ramLivre < 0.15 ? 'alerta' : 'ok', impacto: ramLivre < 0.15 ? 'medio' : 'nenhum',
      achado: `${gb(s.ramLivreGB)} GB livres de ${gb(s.ramTotalGB)} GB no momento da análise.`,
      muda: 'Mostra os programas que mais consomem. Nada é fechado sem a sua confirmação.', ir: 'desempenho', botao: 'Ver processos' });
    cats.push({ id: 'sistema', titulo: 'Tempo ligado', icone: 'relogio', nivel: s.ligadoHa > 72 ? 'alerta' : 'ok', impacto: s.ligadoHa > 72 ? 'baixo' : 'nenhum',
      achado: `Ligado há ${s.ligadoHa} h sem reiniciar.`,
      muda: s.ligadoHa > 72 ? 'Reiniciar fecha programas presos e conclui atualizações. Faça isso você mesmo quando puder — o app não reinicia o PC.' : 'Nada a fazer.' });
    if (s.defender) {
      const ok = s.defender.tempoReal && s.defender.antivirus;
      cats.push({ id: 'protecao', titulo: 'Proteção', icone: 'escudo', nivel: ok ? 'ok' : 'ruim', impacto: ok ? 'nenhum' : 'alto',
        achado: ok ? 'Microsoft Defender ativo com proteção em tempo real.' : 'Proteção em tempo real do Microsoft Defender desligada.',
        muda: 'Abre a Segurança do Windows para você conferir. O app não altera o antivírus.', defender: true, botao: 'Abrir Segurança do Windows' });
    }
  }
  return cats;
}
function calcularNota(cats) {
  // Mesma regra de antes: começa em 100 e desconta pelo que foi encontrado
  const peso = { limpeza: { ruim: 20, alerta: 10 }, startup: { ruim: 15, alerta: 8 }, apps: { alerta: 0 }, disco: { ruim: 20, alerta: 10 }, ram: { alerta: 10 }, sistema: { alerta: 5 }, protecao: { ruim: 15 } };
  let nota = 100;
  for (const c of cats) {
    if (c.id === 'apps') nota -= Math.min(20, apps.filter((a) => a.nivel === 'remover').length * 4);
    else nota -= peso[c.id]?.[c.nivel] || 0;
  }
  return Math.max(0, nota);
}
const IMPACTO = { alto: 'Impacto alto', medio: 'Impacto médio', baixo: 'Impacto baixo', nenhum: 'Tudo certo' };
function montarAnalise(salvar) {
  categorias = montarCategorias();
  if (!categorias.length) return;
  const nota = calcularNota(categorias), problemas = categorias.filter((c) => c.nivel !== 'ok').sort((a, b) => NIVEL[b.nivel] - NIVEL[a.nivel]);
  const est = nota >= 80 ? 'ok' : nota >= 55 ? 'alerta' : 'ruim';
  $('#nota').textContent = nota;
  $('#anelNota').style.strokeDashoffset = 327 - (327 * nota) / 100;
  $('#heroIcone').setAttribute('class', 'icone-escudo ' + est);
  $('#notaTexto').innerHTML = { ok: 'Seu computador está <span class="ok">saudável</span>', alerta: 'Seu computador <span class="alerta">pode melhorar</span>', ruim: 'Seu computador <span class="ruim">precisa de atenção</span>' }[est];
  $('#notaSub').textContent = problemas.length ? `${pl(problemas.length, 'ponto', 'pontos')} para revisar. Nada é alterado sem você confirmar.` : 'Recursos bem utilizados e sem problemas encontrados.';
  $('#notaDicas').innerHTML = problemas.slice(0, 3).map((c) => `<li>${esc(c.achado)}</li>`).join('');
  // Ações recomendadas: só o que precisa de atenção, com o que muda e um botão para revisar
  $('#acoes').innerHTML = problemas.length ? problemas.slice(0, 4).map((c, i) => `
    <div class="acao"><div class="acao-icone ${c.nivel}">${icone(c.icone)}</div>
      <div><b>${esc(c.titulo)}</b><span>${esc(c.achado)}</span></div>
      ${c.ir || c.defender ? `<button data-acao="${i}">${esc(c.botao)}</button>` : ''}</div>`).join('')
    : `<div class="acao"><div class="acao-icone">${icone('escudo')}</div><div><b>Nada importante agora</b><span>Nenhuma ação recomendada nesta análise.</span></div></div>`;
  $$('[data-acao]').forEach((b) => (b.onclick = () => executarAcao(problemas[+b.dataset.acao])));
  // Categorias completas
  $('#categorias').innerHTML = categorias.map((c, i) => `
    <div class="categoria ${c.nivel}">
      <div class="cat-topo"><b>${esc(c.titulo)}</b><span class="impacto ${c.impacto}">${IMPACTO[c.impacto]}</span></div>
      <span class="achado">${esc(c.achado)}</span>
      <span class="muda"><b>O que muda:</b> ${esc(c.muda)}</span>
      ${(c.ir || c.defender) && c.nivel !== 'ok' ? `<button class="pequeno" data-cat="${i}">${esc(c.botao)}</button>` : ''}
    </div>`).join('');
  $$('[data-cat]').forEach((b) => (b.onclick = () => executarAcao(categorias[+b.dataset.cat])));
  if (salvar) api.salvarAnalise({ nota, categorias: categorias.map(({ id, titulo, nivel, impacto, achado }) => ({ id, titulo, nivel, impacto, achado })) }).then(mostrarUltimaAnalise);
}
function executarAcao(c) { if (c.defender) api.abrirDefender(); else if (c.ir) irPara(c.ir); }
function mostrarUltimaAnalise(a) { $('#ultimaAnalise').textContent = a ? `Última análise: ${dataHora(a.data)}` : 'Nenhuma análise realizada ainda.'; }

let analisando = false;
async function executarAnalise() {
  if (analisando) return; analisando = true;
  const b = $('#btnAnalise'); b.disabled = true; b.innerHTML = icone('busca') + 'Analisando...'; $('#btnReanalisar').disabled = true;
  $('#notaTexto').textContent = 'Analisando seu PC...';
  $('#notaSub').textContent = 'Lendo memória, discos, aplicativos, inicialização e arquivos temporários. Nada é alterado.';
  try {
    if (!alvos.length) await carregarAlvos();
    await Promise.all([carregarStatus(), carregarApps(), carregarStartup(), escanear()]);
    montarAnalise(true);
  } finally { analisando = false; b.disabled = false; b.innerHTML = icone('busca') + 'Executar análise'; $('#btnReanalisar').disabled = false; }
}
$('#btnAnalise').onclick = executarAnalise;
$('#btnReanalisar').onclick = executarAnalise;
$('#btnDetalhes').onclick = () => $('#analise').scrollIntoView({ behavior: 'smooth' });

// =================== FERRAMENTAS (Modo Jogo, restauração, permissões) ===================
const SUGESTOES_JOGO = ['OneDrive', 'Teams', 'ms-teams', 'Skype', 'AdobeARM', 'AdobeCollabSync', 'Acrobat', 'AcroCEF', 'Creative Cloud', 'CCXProcess',
  'GoogleDriveFS', 'Dropbox', 'PhoneExperienceHost', 'YourPhone', 'Cortana', 'SearchApp', 'Widgets', 'WidgetService', 'Copilot'];
async function carregarFerramentas() { mostrarAdmin(); await carregarJogo(); }
async function carregarJogo() {
  const e = await api.jogoEstado();
  const ligado = !!e.ativo;
  $('#jogoStatus').classList.toggle('ligado', ligado);
  $('#jogoTexto').textContent = ligado ? 'Ativado' : 'Desativado';
  $('#jogoDetalhe').textContent = ligado
    ? `Ligado desde ${dataHora(e.desde)}. Desative ao terminar para voltar ao plano de energia normal.`
    : 'Troca o plano de energia para desempenho máximo, fecha os programas que você marcar e libera RAM. Ao desativar, volta o plano de energia que você usava (programas fechados não reabrem sozinhos).';
  $('#btnJogo').textContent = ligado ? 'Desativar Modo Jogo' : 'Ativar Modo Jogo';
  $('#btnJogo').className = ligado ? 'perigo' : 'primario';
  $('#badgeJogo').textContent = ligado ? 'ON' : '';
  if (!procs.length) await carregarProcessos();
  renderJogoProcessos();
}
function renderJogoProcessos() {
  const salvos = ler('jogoFechar', null);
  const lista = procs.filter((p) => !p.protegido);
  $('#jogoProcessos').innerHTML = lista.length ? lista.map((p) => {
    const marcado = salvos ? salvos.includes(p.nome) : SUGESTOES_JOGO.some((s) => p.nome.toLowerCase() === s.toLowerCase());
    return `<label><input type="checkbox" data-jogo="${esc(p.nome)}" ${marcado ? 'checked' : ''}>${esc(p.descricao || p.nome)} <small>${mb(p.ramMB)}</small></label>`;
  }).join('') : '<p class="vazio">Carregando programas...</p>';
  $$('[data-jogo]').forEach((c) => (c.onchange = () => guardar('jogoFechar', [...$$('[data-jogo]')].filter((x) => x.checked).map((x) => x.dataset.jogo))));
}
$('#btnAtualizarJogo').onclick = async () => { await carregarProcessos(); renderJogoProcessos(); };
$('#btnJogo').onclick = async () => {
  const e = await api.jogoEstado();
  if (e.ativo) {
    carregando(true, 'Voltando ao normal...'); const r = await api.jogoDesativar(); carregando(false);
    resultado(r, 'Modo Jogo desativado. Plano de energia restaurado.');
  } else {
    const fechar = [...$$('[data-jogo]')].filter((x) => x.checked).map((x) => x.dataset.jogo);
    carregando(true, 'Aguardando confirmação...');
    const r = await api.jogoAtivar({ fechar, ram: $('#jogoRam').checked, planoMaximo: $('#jogoPlanoMax').checked });
    carregando(false);
    resultado(r, 'Modo Jogo ativado\n' + (r?.passos || []).join('\n'));
  }
  carregarJogo();
};
$('#btnCriarPonto').onclick = async () => {
  carregando(true, 'Criando ponto de restauração...');
  const r = await api.criarRestauracao(); carregando(false);
  resultado(r, 'Ponto de restauração criado.');
};
$('#btnAbrirRestauracao').onclick = () => api.abrirRestauracao();
$('#btnDefender').onclick = () => api.abrirDefender();

// =================== RELATÓRIOS ===================
async function carregarRelatorios() {
  const a = await api.ultimaAnalise();
  $('#relAnalise').innerHTML = a
    ? `<div class="linha-titulo"><h3>Última análise</h3><span class="dica">${dataHora(a.data)} · índice de saúde <b>${a.nota}</b>/100</span></div>
       <div class="rel-grade">${(a.categorias || []).map((c) => `<div><small>${esc(c.titulo)}</small><b class="tag ${c.nivel === 'ok' ? 'ok' : c.nivel === 'ruim' ? 'falha' : 'parcial'}">${IMPACTO[c.impacto] || ''}</b><p class="dica">${esc(c.achado)}</p></div>`).join('')}</div>`
    : '<h3>Última análise</h3><p class="dica">Nenhuma análise realizada ainda.</p>';
  const h = await api.historico();
  const rotulo = { ok: 'Concluído', falha: 'Falhou', parcial: 'Parcial', pendente: 'Aguardando launcher' };
  $('#historico').innerHTML = h.length ? h.map((x) => `<tr>
      <td><time>${dataHora(x.data)}</time></td><td>${esc(x.msg)}</td>
      <td>${x.desfeito ? '<b class="tag desfeito">Desfeito</b>' : `<b class="tag ${x.resultado}">${rotulo[x.resultado] || 'Concluído'}</b>`}</td>
      <td>${x.podeDesfazer ? `<button class="pequeno" data-desfazer="${esc(x.id)}">${icone('voltar')}Desfazer</button>` : ''}</td></tr>`).join('')
    : '<tr><td colspan="4" class="vazio">Nada feito ainda.</td></tr>';
  $$('[data-desfazer]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    const r = await api.desfazer(b.dataset.desfazer);
    if (resultado(r, 'Ação desfeita.')) { await carregarStartup(); montarAnalise(false); carregarJogo(); }
    carregarRelatorios();
  }));
}

// =================== INÍCIO ===================
(async () => {
  admin = !!(await api.adminEstado())?.admin; mostrarAdmin();
  mostrarUltimaAnalise(await api.ultimaAnalise());
  const e = await api.jogoEstado(); $('#badgeJogo').textContent = e.ativo ? 'ON' : '';
  await executarAnalise();
  carregarProcessos();
})();
