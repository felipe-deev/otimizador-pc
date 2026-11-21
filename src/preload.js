const { contextBridge, ipcRenderer } = require('electron');
const call = (canal) => (...args) => ipcRenderer.invoke(canal, ...args);

contextBridge.exposeInMainWorld('api', {
  status: call('status'),
  monitor: call('monitor'),
  processos: call('processos'),
  finalizar: call('processos:finalizar'),
  listarApps: call('apps:listar'),
  desinstalar: call('apps:desinstalar'),
  listarStartup: call('startup:listar'),
  alternarStartup: call('startup:alternar'),
  alvosLimpeza: call('limpeza:alvos'),
  escanearLimpeza: call('limpeza:escanear'),
  limpar: call('limpar'),
  liberarRAM: call('ram'),
  ultimaAnalise: call('analise:ultima'),
  salvarAnalise: call('analise:salvar'),
  criarRestauracao: call('restauracao:criar'),
  abrirRestauracao: call('restauracao:abrir'),
  historico: call('historico'),
  desfazer: call('historico:desfazer'),
  jogoEstado: call('jogo:estado'),
  jogoAtivar: call('jogo:ativar'),
  jogoDesativar: call('jogo:desativar'),
  adminEstado: call('admin:estado'),
  reiniciarAdmin: call('admin:reiniciar'),
  abrirDefender: call('abrir:defender'),
  onProgresso: (cb) => ipcRenderer.on('progresso', (_e, msg) => cb(msg))
});
