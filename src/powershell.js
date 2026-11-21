// Executa scripts PowerShell e devolve JSON. Usa -EncodedCommand para evitar problemas de aspas.
const { execFile } = require('child_process');

function runPS(script, timeout = 120000) {
  const full = `$ErrorActionPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8;\n${script}`;
  const encoded = Buffer.from(full, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout, maxBuffer: 50 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err && !stdout) return reject(new Error(stderr || err.message));
        const out = stdout.trim();
        if (!out) return resolve(null);
        try { return resolve(JSON.parse(out)); } catch {}
        // Algum comando imprimiu texto antes do resultado: usa a última linha que for JSON
        const linha = out.split(/\r?\n/).reverse().find((l) => /^\s*[[{]/.test(l));
        try { if (linha) return resolve(JSON.parse(linha)); } catch {}
        resolve({ ok: false, erro: 'Resposta inesperada do PowerShell: ' + out.slice(0, 300) });
      });
  });
}

// PowerShell que fica aberto e entrega cada linha JSON que imprimir (coletores em tempo real)
function streamPS(script, aoReceber) {
  const { spawn } = require('child_process');
  const full = `$ErrorActionPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8;\n${script}`;
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(full, 'utf16le').toString('base64')],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let resto = '';
  p.stdout.on('data', (d) => {
    const linhas = (resto + d.toString()).split(/\r?\n/); resto = linhas.pop();
    for (const l of linhas) { try { aoReceber(JSON.parse(l)); } catch {} }
  });
  return p;
}

// Passa parâmetros com segurança: vira JSON dentro de string PowerShell com aspas simples escapadas
const psParam = (obj) => `('${JSON.stringify(obj).replace(/'/g, "''")}' | ConvertFrom-Json)`;

module.exports = { runPS, streamPS, psParam };
