[English](https://github.com/gabrielvieiraf/julius2claude/blob/main/README.md) | **Português**

# julius2claude

Use várias contas do Claude no Claude Code e troque automaticamente quando uma atingir o limite de uso.
Um gerenciador de contas do Claude Code que retoma a mesma sessão na próxima conta.

<p align="center">
  <a href="https://tenor.com/view/money-terry-crews-spilled-milk-thrifty-gif-7197529"><img src="https://media.tenor.com/x5fKOq1dsNYAAAAC/money-terry-crews.gif" alt="Julius de Todo Mundo Odeia o Chris: 49 centavos de leite derramado na minha mesa" width="480"></a>
</p>

[![npm](https://img.shields.io/npm/v/julius2claude?color=cb3837&logo=npm)](https://www.npmjs.com/package/julius2claude)
[![npm downloads](https://img.shields.io/npm/dm/julius2claude?color=cb3837)](https://www.npmjs.com/package/julius2claude)
[![CI](https://github.com/gabrielvieiraf/julius2claude/actions/workflows/ci.yml/badge.svg)](https://github.com/gabrielvieiraf/julius2claude/actions/workflows/ci.yml)
[![Licença: AGPL-3.0](https://img.shields.io/badge/licen%C3%A7a-AGPL--3.0-blue)](https://github.com/gabrielvieiraf/julius2claude/blob/main/LICENSE)

## Visão geral

O julius2claude (comando `j2c`) executa o Claude Code oficial em várias contas que pertencem a
você: um plano pessoal Claude Pro ou Max, um plano Team ou Enterprise da empresa, Amazon Bedrock,
Google Vertex AI, Microsoft Foundry ou uma API key da Anthropic.

Cada conta mantém o próprio login. O histórico de conversas é compartilhado entre as contas do
mesmo grupo. Quando a conta ativa atinge o limite de 5 horas ou o limite semanal, a sessão pode
passar para a próxima conta ao final da resposta atual e retomar a mesma conversa, no mesmo
diretório.

## Funcionalidades

- **Um perfil por conta.** Cada perfil executa o Claude Code com a própria `CLAUDE_CONFIG_DIR`,
  que é a configuração documentada pela Anthropic para usar várias contas. Credenciais nunca são
  copiadas entre perfis.
- **Troca por limite (opcional).** Detecta os limites de 5 horas, semanal e semanal por modelo, e
  move a sessão para o próximo perfil elegível entre uma resposta e outra.
- **Nenhum trabalho interrompido.** A troca nunca acontece durante a execução de uma ferramenta.
  Trocas preventivas aguardam subagentes e tarefas de shell em segundo plano terminarem.
- **Provedores de nuvem e API.** Perfis Amazon Bedrock, Google Vertex AI, Microsoft Foundry e API
  key. Perfis cobrados por uso só são usados automaticamente com autorização explícita.
- **Vínculo de diretórios.** Associe um diretório a um perfil, opcionalmente em modo estrito, para
  que um repositório da empresa só rode na conta da empresa.
- **Grupos de dados.** Perfis de grupos diferentes nunca compartilham histórico, e uma sessão nunca
  muda de grupo.
- **Recuperação após falhas.** Sessões interrompidas no meio de uma resposta por queda da máquina,
  reinício do WSL ou fechamento do terminal podem ser listadas e retomadas com `j2c recover`.
- **Integração com o Claude Code.** Comandos `/j2c:use`, `/j2c:next` e `/j2c:status`, e uma
  statusline com o perfil ativo e o seu uso.

## Requisitos

- Claude Code 2.1.152 ou superior (recomendado 2.1.248 ou superior)
- Node.js 18 ou superior
- Linux, WSL2 ou macOS. O suporte ao Windows nativo é experimental.

## Instalação

### Deixe o Claude Code configurar

Abra o Claude Code e envie:

```text
Instale e configure o julius2claude para mim. Siga https://github.com/gabrielvieiraf/julius2claude/blob/main/docs/AGENT-SETUP.md
```

O Claude instala o pacote, pergunta quais contas você usa, envia um link de login para cada uma e
finaliza a configuração. Você só entra na conta e cola o código exibido ao final de cada login.

### Instalação manual

```bash
npm install -g julius2claude
```

Para instalar a versão mais recente direto do GitHub:

```bash
npm install -g github:gabrielvieiraf/julius2claude
```

## Início rápido

```bash
j2c setup              # registra o login atual do Claude Code como perfil "main"
j2c add work           # adiciona uma segunda conta e abre o login dela
j2c                    # inicia o Claude Code; aceita os mesmos argumentos do `claude`
```

A troca automática vem desativada:

```bash
j2c auto on
```

Para que toda sessão passe pelo julius2claude, adicione `alias claude=j2c` ao perfil do seu shell.

## Configuração

### Perfis

```bash
j2c add work                                         # conta do claude.ai (Pro, Max, Team, Enterprise)
j2c add corp --group company                         # grupo de dados separado
j2c add aws --bedrock --aws-profile dev --region us-east-1
j2c add gcp --vertex --project my-project --region us-east5
j2c add az --foundry --resource my-foundry
j2c add api --api-key-helper "op read op://dev/anthropic/key"
j2c login <perfil>                                   # fazer login novamente
j2c login <perfil> --start | --code <código>         # login em duas etapas, usado por agentes de IA
```

Durante o `j2c login`, aperte `c` para copiar o link de login ou `o` para abrir no navegador, e
depois cole o código. Quando possível, o link também é copiado automaticamente.

```bash
j2c remove <perfil> [--purge]
```

O julius2claude não armazena segredos. Perfis Bedrock e Vertex usam as cadeias de credenciais
padrão da AWS e do Google Cloud. API keys são lidas em tempo de execução a partir do comando
informado em `--api-key-helper`. Um perfil Bedrock também pode ser configurado com
`/setup-bedrock` dentro de uma sessão iniciada com `j2c -P <perfil>`.

### Ordem de troca e troca automática

```bash
j2c order main work aws
j2c auto on [--paid] [--5h 95] [--weekly 98] [--dwell 10]
j2c auto off
```

| Opção | Padrão | Descrição |
|---|---|---|
| `--5h` | 95 | Troca quando a janela de 5 horas atinge esta porcentagem |
| `--weekly` | 98 | Troca quando a janela semanal atinge esta porcentagem |
| `--dwell` | 10 | Minutos mínimos em um perfil antes de uma troca preventiva |
| `--paid` | desativado | Permite trocar automaticamente para perfis cobrados por uso |

Um perfil que recusa uma requisição (limite de uso, erro de autenticação, política da organização)
é abandonado imediatamente, independentemente de `--dwell`. Quando todos os perfis elegíveis estão
esgotados, o julius2claude aguarda o primeiro limite a ser renovado e retoma a sessão nele.

### Vínculo de diretórios

```bash
j2c bind corp ~/company --strict
j2c unbind ~/company
```

Um vínculo define o perfil das novas sessões iniciadas naquele diretório e nos seus
subdiretórios. No modo estrito, nenhum outro perfil pode ser usado ali.

## Uso

```bash
j2c                     # inicia no perfil vinculado ao diretório ou no padrão
j2c -P work             # inicia em um perfil específico
j2c -c                  # continua a última conversa deste diretório, supervisionada
j2c --no-binding        # ignora os vínculos de diretório nesta sessão
j2c use work            # define o perfil padrão
j2c usage               # uso visual de todos os perfis: barras de 5h e semanal, renovações, tokens
j2c status [--json]     # perfis, uso e horários de renovação
j2c stats [--days N]    # tokens por perfil e tempo até atingir cada limite
j2c recover [n]         # lista ou retoma sessões interrompidas
j2c rescue [n] [--model sonnet]  # move uma sessão travada no limite para a próxima conta
j2c doctor              # diagnostica problemas comuns
```

Dentro do Claude Code:

| Comando | Descrição |
|---|---|
| `/j2c:usage` | Uso visual de todos os perfis |
| `/j2c:status` | Perfis, uso e o perfil da sessão atual |
| `/j2c:stats` | Tokens por perfil e tempo até atingir cada limite |
| `/j2c:use <perfil>` | Move a sessão atual para um perfil ao final da resposta |
| `/j2c:next` | Move a sessão atual para o próximo perfil com uso disponível |

A statusline mostra o perfil ativo e o seu uso, por exemplo
`j2c main · 5h ▰▰▰▰▱ 82% · 7d 31%`. Ela avisa quando um perfil está perto do limite e, depois de
uma troca, mostra de onde a sessão veio e por quê, inclusive quando ela passa para outra
organização. Uma statusline personalizada já existente é mantida e exibida logo abaixo.

Uma sessão trocada é retomada com o mesmo modo de permissão (por exemplo, auto mode), modelo e
esforço que tinha, e continua trabalhando sem novos pedidos de permissão.

### Resgatar uma sessão travada no limite

Uma sessão iniciada com `claude` não troca de conta sozinha e, depois de atingir o limite, recusa
qualquer mensagem, inclusive o `/j2c:next`. Rode `j2c rescue` em qualquer terminal:

```bash
j2c rescue                    # sessões travadas no limite, das mais recentes para as mais antigas
j2c rescue 1 --model sonnet   # encerra a sessão e a retoma aqui na próxima conta
```

Ele mostra a conta e o limite que pararam cada sessão, quando o limite é renovado e quais agentes em
segundo plano foram interrompidos. Com a sua confirmação, encerra o processo travado, registra o
limite, retoma a mesma conversa no próximo perfil disponível e pede ao Claude que verifique o que os
agentes interrompidos concluíram e execute de novo apenas o que faltou. O `--model` vale também para
os agentes executados novamente.

### Vários terminais

Todo terminal iniciado com `j2c` é supervisionado, e todos compartilham os mesmos perfis e limites.
Quando um terminal atinge um limite, os outros no mesmo perfil trocam ao final da próxima resposta,
sem enviar uma requisição que seria recusada. Sessões iniciadas com `claude` não são
supervisionadas; reinicie com `j2c -c` no mesmo diretório.

### Estatísticas de uso

O `j2c stats` mostra, para cada perfil:

- tokens usados nas últimas 5 horas, nos últimos 7 dias e no total, separados em entrada, saída,
  leitura de cache e escrita de cache
- quantas vezes cada limite (5 horas, semanal, semanal por modelo) foi atingido, quanto tempo depois
  do início da janela em média, e quantos tokens foram usados naquela janela
- quantas trocas preventivas aconteceram nos seus limites configurados, e quantas sessões saíram e
  entraram no perfil

```text
main (me@personal.dev)
  tokens   last 5h 4.1M · last 7 days 38.2M · total 112.5M
           input 41.0k · output 1.9M · cache read 104.3M · cache write 6.3M
  5-hour limit: reached 3 times, after 3h 12m on average, ~4.0M tokens per window
  weekly limit: reached 1 time, after 4d 6h on average, ~36.9M tokens per window
  switches  4 away · 1 onto this account
```

Os tokens são lidos dos históricos das sessões iniciadas com `j2c`, e cada resposta é contada uma
única vez, no perfil que a gerou. Use `--json` em scripts e `--days N` para limitar o período.

## Como funciona

<p align="center">
  <img src="https://raw.githubusercontent.com/gabrielvieiraf/julius2claude/main/docs/how-it-works.pt-BR.svg" alt="Fluxo: o j2c inicia o claude por perfil; uso e estado da sessão são acompanhados; quando o limite é atingido e a resposta terminou, o claude é encerrado e a mesma sessão é retomada no próximo perfil" width="560">
</p>

1. **Isolamento.** O `~/.claude` continua sendo o perfil principal. Os demais perfis ficam em
   `~/.julius2claude/profiles/<nome>`. Histórico, comandos, skills e agentes são compartilhados por
   links de diretório. Arquivos nunca são linkados, porque o Claude Code substitui arquivos de
   forma atômica.
2. **Acompanhamento de uso.** O Claude Code envia `rate_limits` (porcentagens e horários de
   renovação das janelas de 5 horas e de 7 dias) para a statusline após cada resposta. O
   julius2claude armazena esses valores por perfil, sem fazer requisições de rede.
3. **Detecção de limite.** Quando uma requisição é recusada, o Claude Code registra o tipo de
   limite e o horário de renovação no histórico da sessão. O julius2claude lê esse registro quando
   o hook `StopFailure` é disparado, incluindo os históricos dos subagentes.
4. **Troca.** Ao final da resposta, o julius2claude encerra a árvore de processos do `claude`
   (SIGINT, depois SIGTERM, depois SIGKILL), restaura o estado do terminal e executa
   `claude --resume <sessão>` com o próximo perfil, no mesmo diretório. Se a resposta foi cortada
   pelo limite, a sessão retomada é instruída a verificar a última chamada de ferramenta antes de
   continuar.

## Confiabilidade

Todos os modos de falha conhecidos na troca de contas do Claude Code estão documentados em
[docs/FAILURE-MODES.md](https://github.com/gabrielvieiraf/julius2claude/blob/main/docs/FAILURE-MODES.md) (em inglês), com a mitigação e o teste automatizado
que cobre cada um. Destaques:

- Tokens de renovação só podem ser usados uma vez. Copiá-los entre contas invalida o login, por
  isso o julius2claude nunca copia credenciais.
- Verificações de estado apenas leem arquivos. Comandos como `claude auth status` podem renovar um
  token e nunca são executados.
- A espera automática do próprio Claude Code no limite de uso é desativada nas sessões
  supervisionadas enquanto a troca automática está ligada.
- Variáveis de autenticação do shell (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_USE_BEDROCK` e outras) são
  removidas para que não substituam um perfil sem aviso.
- Todo o estado é gravado de forma atômica e com trava.

## Perguntas frequentes

**Como usar duas contas do Claude no Claude Code?**
Adicione cada conta extra com `j2c add <nome>` e inicie as sessões com `j2c -P <nome>`. Sessões em
perfis diferentes podem rodar ao mesmo tempo.

**Como trocar de conta quando o Claude Code atinge o limite de uso?**
Execute `/j2c:next` dentro da sessão, ou ative a troca automática com `j2c auto on`.

**A conversa é preservada após a troca?**
Sim. A mesma sessão é retomada no mesmo diretório. Como o cache de prompt é separado por conta, a
primeira requisição na nova conta processa todo o contexto novamente. Por isso o julius2claude
mantém o número de trocas baixo.

**Há suporte ao Amazon Bedrock?**
Sim. Crie um perfil com `j2c add <nome> --bedrock`. A troca automática só o utiliza após
`j2c auto on --paid`.

**Como manter o trabalho da empresa na conta da empresa?**
Coloque o perfil da empresa em um grupo próprio (`j2c add corp --group company`) e vincule os
diretórios da empresa a ele em modo estrito (`j2c bind corp ~/company --strict`).

**O que acontece se a máquina ou o WSL parar durante uma tarefa?**
Execute `j2c recover` e selecione a sessão. Ela é retomada no diretório e no perfil originais.

**Funciona com a extensão do VS Code ou com o Claude Desktop?**
Não. O julius2claude supervisiona o processo `claude` do terminal.

**É compatível com os termos da Anthropic?**
O julius2claude apenas inicia o Claude Code oficial com o fluxo de login da própria Anthropic e usa
a configuração de várias contas descrita na documentação do Claude Code. Ele não copia, compartilha
nem intermedia credenciais. Use somente com contas que pertencem a você e siga as políticas da sua
empresa. Os limites de uso da Anthropic pressupõem uso individual comum, e alternar várias contas
para contorná-los pode violar os termos; por isso a troca automática vem desativada. O
julius2claude não tem vínculo com a Anthropic.

## Plataformas

| Plataforma | Situação |
|---|---|
| Linux | Suportado |
| WSL2 | Suportado. Mantenha `~/.julius2claude` no sistema de arquivos do Linux. |
| macOS | Beta. A validade do login fica no Keychain e aparece como desconhecida. |
| Windows | Experimental. Diretórios compartilhados usam junctions. |

## Dados e privacidade

- Sem telemetria.
- Os valores dos tokens nunca são lidos nem gravados. Apenas as datas de validade são lidas.
- O estado fica em `~/.julius2claude`: configuração, registros de uso e um registro de sessões
  usado na recuperação. Os logs ficam em `~/.julius2claude/j2c.log`.

## Desenvolvimento

```bash
git clone https://github.com/gabrielvieiraf/julius2claude
cd julius2claude
npm install
npm test
```

As mensagens de commit seguem o [Conventional Commits](https://www.conventionalcommits.org) e são verificadas no commit. Releases, changelog e publicação no npm são automatizados a partir delas.

Arquitetura, estrutura de dados e invariantes estão descritos no [AGENTS.md](https://github.com/gabrielvieiraf/julius2claude/blob/main/AGENTS.md). Inclua a
saída do `j2c doctor` ao reportar problemas.

## Licença

[AGPL-3.0](https://github.com/gabrielvieiraf/julius2claude/blob/main/LICENSE). Quem distribuir uma versão modificada, inclusive como serviço de rede, deve
disponibilizar o código-fonte sob a mesma licença.

O nome faz referência ao Julius, pai do Chris em *Todo Mundo Odeia o Chris*, que tem dois empregos
e controla cada centavo.
