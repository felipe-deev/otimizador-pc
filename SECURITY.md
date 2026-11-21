# Política de segurança

O VOLT PC Otimizador executa comandos no Windows (limpeza de arquivos, desinstalação de aplicativos, itens de inicialização). Por isso, falhas de segurança são levadas a sério.

## Versões com suporte

| Versão | Suporte |
|---|---|
| 1.0.x (branch `main`) | ✅ Recebe correções |
| Versões anteriores | ❌ |

## Como reportar uma falha

**Não abra uma issue pública** para falhas de segurança.

1. Vá até a aba **Security** do repositório.
2. Clique em **Report a vulnerability**, que abre um relatório privado só para o autor.
3. Descreva o problema, como reproduzir e qual o impacto (por exemplo, apagar arquivos fora das pastas de limpeza ou executar comandos sem confirmação).

Você recebe uma resposta assim que possível. Depois que a correção for publicada, o crédito pela descoberta pode ser dado, se você quiser.

## O que conta como falha de segurança

- Apagar, alterar ou desinstalar algo **sem a confirmação** do usuário.
- Apagar arquivos **fora** das categorias de limpeza mostradas na tela.
- Permitir que a interface execute comandos arbitrários no sistema (a interface só deveria enviar IDs ao processo principal).
- Pedir ou usar permissão de Administrador sem necessidade.
- Expor dados pessoais do usuário.

## Proteções já existentes no app

- `contextIsolation` ativado e `nodeIntegration` desativado na janela.
- A interface só envia IDs e nomes. Os comandos PowerShell ficam no processo principal (`src/main.js` e `src/scripts.js`).
- Parâmetros passados ao PowerShell são convertidos em JSON, sem montar comandos com texto do usuário.
- Toda ação que altera o sistema passa por uma janela de confirmação com a lista do que vai mudar.
- O app abre sem Administrador e só pede elevação quando você clica em "Reiniciar como administrador".
