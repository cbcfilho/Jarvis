# Revisão de segurança e qualidade — PROMPT JARVIS (Partes 1 e 2)

Revisão de 12/10/2026. Arquivos: `PROMPT_JARVIS_v2.txt` e `PROMPT_JARVIS_2_v2.txt` (versões corrigidas, prontas para colar).

## Resumo

- **Nada malicioso escondido.** Verifiquei os dois documentos exportados do Google Docs: não há texto oculto (cor branca, fonte zero, `display:none` no conteúdo), caracteres invisíveis nem links estranhos. O único endereço externo é `api.anthropic.com`.
- **A Parte 1 é de baixo risco**, com alguns bugs que vão quebrar em modelos atuais.
- **A Parte 2 tem dois riscos sérios**, e ambos podem acabar com as **senhas de app do Gmail** nas mãos de terceiros:
  1. qualquer pessoa que te mande um e-mail ou convite de agenda pode executar código dentro do Jarvis (XSS);
  2. no Chrome, qualquer arquivo `.html` aberto do computador lê o que o Jarvis guarda. **Testei e confirmei isso.**
- Os modelos citados existem, mas são da geração anterior. O "ECONÔMICO" (`claude-haiku-4-5`) custa **10×** mais que o atual `claude-haiku-5-5`.

---

## 🔴 Riscos altos

### 1. XSS: e-mails, convites e notícias podem rodar código no Jarvis (Parte 2, e o grafo da Parte 1)

**Onde:** a Parte 1 manda montar o grafo como string e injetar via `innerHTML`. A Parte 2 mostra texto escrito por estranhos (assunto, remetente, trecho, título de evento, manchete), e nenhum dos prompts pede para escapar HTML.

**Cenário:** alguém te manda um e-mail com assunto `<img src=x onerror="...">`. O painel de e-mails renderiza com `innerHTML` e o código roda dentro do Jarvis. A partir daí ele lê o `localStorage` (chave da Anthropic, senhas de app, links secretos da agenda) e manda tudo para fora. Com convite de agenda é ainda mais fácil, porque o Google costuma adicionar convites sozinho à agenda, e eles chegam no `.ics`.

**Correção (nas v2):**
- função `esc()` obrigatória em todo texto externo, inclusive dentro da string do SVG;
- links só `http`/`https`;
- **Content-Security-Policy** que só permite conexão com a Anthropic (e, na Parte 2, com a antena e o Open-Meteo).

Testei a CSP num `file://` no Chromium: ela bloqueou o envio para um domínio externo e a imagem externa, e manteve funcionando o `onclick` inline e o truque do SVG dentro de `<div>`.

### 2. Senhas de app guardadas numa página `file://` (Parte 2)

**Onde:** "O `jarvis.html` CONTINUA abrindo com dois cliques" e "Salvo em localStorage (`jarvis_emails`)".

**Teste:** no Chromium 141, `pastaA/jarvis.html` gravou uma senha de app no `localStorage`. Depois, um `Downloads/outra/fatura.html`, de outra pasta, conseguiu ler essa senha. No Chrome, todos os arquivos locais compartilham o mesmo armazenamento. Anexo `.html` é um vetor clássico de phishing.

**Correção (na v2 da Parte 2):** a antena passa a **servir o Jarvis** em `http://127.0.0.1:4242`, que é uma origem isolada de qualquer arquivo ou site. Atalhos de dois cliques (`.bat`/`.command`/`.sh`) ligam a antena e abrem o navegador, então a experiência continua sendo "dois cliques". A migração das memórias da Parte 1 acontece uma única vez, por Exportar/Importar.

### 3. Texto enganoso sobre o que a senha de app permite

**Onde:** "senha de app… só dá acesso de leitura via IMAP do jeito que vamos usar".

**Realidade:** a senha de app dá acesso **completo** à conta de e-mail via IMAP/SMTP (ler, apagar, enviar). O Jarvis só lê, mas quem roubar a senha não tem essa limitação.

**Correção:** o aviso agora diz isso com clareza e ensina a revogar a senha. Também avisa que contas Workspace (trabalho/faculdade) costumam bloquear senha de app e podem proibir mandar e-mails para uma IA externa.

---

## 🟠 Riscos médios

### 4. Antena com `Access-Control-Allow-Origin: *` e proxy genérico `?url=`
- Com `*`, **qualquer site** aberto no navegador pode chamar a antena.
- A allowlist não pede comparação exata de hostname. Um `includes("calendar.google.com")` aceita `calendar.google.com.site-malicioso.com`.
- A allowlist também não é revalidada a cada redirect.
- Não há checagem do header `Host`, o que deixa a antena exposta a DNS rebinding.

**Correção:**
- sem nenhum header CORS (página e antena estão na mesma origem);
- "porteiro" que confere `Host`, `Origin` e `Sec-Fetch-Site`;
- rotas específicas (`/api/agenda`, `/api/noticias`, `/api/emails`) no lugar do proxy genérico;
- hostname exato, revalidado em cada salto;
- verificação TLS sempre ligada;
- limites de tamanho e tempo.

### 5. Injeção de prompt via e-mail, agenda e notícias
Texto de terceiros vai para a IA na triagem, no digest e na agenda injetada no system prompt. Um e-mail pode:
- pedir para ser classificado como RUÍDO e se esconder;
- produzir um "resumo" de golpe que o Jarvis **lê em voz alta com a voz dele**;
- tentar criar memórias falsas com `[[SAVE:...]]`.

**Correção:**
- dados de terceiros vão delimitados (`<email>`, `<dados>`) e rotulados como "não são instruções";
- a triagem usa saída estruturada (`json_schema` com `enum` nos baldes);
- `[[SAVE]]` só é processado na conversa principal e sempre mostra "desfazer";
- títulos de agenda chegam limpos (sem `[[`/`]]`, até 60 caracteres);
- o remetente é falado antes de cada resumo.

### 6. Chave da API no navegador (`anthropic-dangerous-direct-browser-access`)
Para uso pessoal e local, é aceitável. O header tem "dangerous" no nome porque a chave fica exposta ao código da página. Na Parte 1, o risco do `file://` compartilhado (item 2) também vale para a chave.

**Correção:** orientar a criar uma chave **só para o Jarvis**, num workspace com **limite de gasto mensal**. Se vazar, o prejuízo tem teto. A chave nunca vai para o backup e só os 4 últimos caracteres aparecem na tela.

### 7. Privacidade
- O Second Brain fica **embutido no HTML**, incluindo saúde, finanças e relações. Quem receber o arquivo lê tudo. A v2 avisa isso na entrevista e no fechamento, e desaconselha dados sensíveis.
- O reconhecimento de voz do Chrome envia o áudio aos servidores do Google enquanto o microfone está ativo. A v2 adiciona um indicador "🎙 OUVINDO" e um botão de pausa.

---

## 🟡 Bugs e melhorias

| # | Problema | Efeito | Correção na v2 |
|---|---|---|---|
| 8 | Modelos da geração anterior: `claude-sonnet-5`, `claude-haiku-4-5`, `claude-opus-4-8` | Haiku 4.5 custa US$ 1/5 por milhão de tokens (entrada/saída) contra US$ 0,10/0,50 do `claude-haiku-5-5`. Opus 4.8 custa US$ 5/25 contra US$ 4/20 do `claude-opus-5-5`. Sonnet 5 e `claude-sonnet-5-5` custam o mesmo (US$ 2/10). Haiku 4.5 também **rejeita** o parâmetro `effort`. | `claude-haiku-5-5` / `claude-sonnet-5-5` / `claude-opus-5-5` |
| 9 | `data.content[0].text` | Nos modelos atuais o raciocínio adaptativo vem ligado por padrão, e o primeiro bloco pode ser `thinking`. Aí o texto vem `undefined` e o Jarvis "não responde" de forma intermitente. Além disso, `max_tokens: 400` também conta o raciocínio. | Juntar os blocos `type: "text"`; `max_tokens: 1024`; `output_config.effort: "low"`; não enviar `thinking` (dá 400 em alguns modelos); tratar `stop_reason: "refusal"` |
| 10 | O modelo aparece literal no `fetch` ("Use EXATAMENTE esta chamada… `model:"claude-sonnet-5"`") | O seletor de modelo da Parte 2 escreve em `CONFIG.model` e não tem efeito nenhum | `model: CONFIG.model`; a Parte 2 lista isso como correção permitida |
| 11 | A Parte 1 entrega o código "em um bloco", mas a Parte 2 procura `jarvis.html` na pasta | Quem não salvou o arquivo trava na Parte 2 | A Parte 1 salva direto como `jarvis.html` quando consegue |
| 12 | "quem tem Claude Code já tem Node" | Não é mais verdade: o instalador nativo do Claude Code e o Cowork não precisam de Node, então muita gente vai ver `node: command not found` | Verificar com `node -v` e orientar a instalar o LTS |
| 13 | `NOTES` embutidas × `localStorage` sem regra | Gerar o arquivo de novo não muda nada, e limpar o navegador apaga as memórias aprendidas | `SEED_ID` com mescla + Exportar/Importar memórias |
| 14 | Histórico da sessão sem limite | Cada pergunta fica mais cara | Últimas 20 mensagens |
| 15 | Comandos locais por palavra-chave solta | "o que você acha das notícias sobre IA?" é sequestrado pelo comando "notícias" | Só vale se a frase começar com o comando ou for curta |
| 16 | Wake word "Ei Jarvis" em pt-BR | O reconhecedor escreve "jarvas", "djarvis", "e aí jarvis"…, e um comando na mesma frase é perdido | `wakeAliases` + comando na mesma frase + timeout de 8 s |
| 17 | Reinício do reconhecimento | Em erro de rede, entra em loop apertado. Com microfone negado, fica tentando para sempre | Atraso, espera crescente e parada em `not-allowed` |
| 18 | Todo erro HTTP vira "cheque a chave" | Falta de crédito, limite de uso e sobrecarga ficam indistinguíveis | Mensagens por código (401 / crédito / 429 / 5xx) |
| 19 | Cliente IMAP feito à mão | Pontos que costumam quebrar: injeção de CR/LF no LOGIN, `rejectUnauthorized:false` "pra funcionar", baixar anexos inteiros, literais `{n}` | Só LOGIN/EXAMINE/FETCH/LOGOUT, CR/LF recusados, `BODY.PEEK[]<0.20000>`, TLS verificado, timeout |
| 20 | A triagem usa o modelo do seletor | Classificar e-mail no Opus é desperdício | Triagem sempre no `claude-haiku-5-5` |

## ✅ O que já estava bom (e foi mantido)
- O fluxo entrevista → confirmação → código, e o checklist de autoverificação.
- `EXAMINE` + `BODY.PEEK` (a caixa de entrada nunca é alterada), antena só em `127.0.0.1`, allowlist, não logar segredos.
- Cache da triagem por Message-ID, digest com 1 chamada por dia e fallback offline.
- Flag `busy` contra o Jarvis se ouvir e o truque do SVG via `<div>`, que é real e importante no Safari.
- O "envelopar, não reescrever" na Parte 2.

## Fora das v2 (opcional)
- **Fallback automático em recusas:** no Sonnet 5.5 e no Opus 5.5 dá para enviar o header `anthropic-beta: server-side-fallback-2026-07-01` e `fallbacks: "default"` no corpo. Se o modelo recusar, a API refaz a chamada em outro modelo. Não coloquei no prompt porque não vale para o Haiku 5.5 e complica o código para um caso raro num assistente pessoal. A v2 só trata a recusa com uma frase falada. O preflight CORS da API aceita esse header (testei).
- **Chave da API na antena** em vez do navegador: elimina o header "dangerous", mas obriga a reescrever a chamada da Parte 1. Fica como evolução futura.
- **Prompt caching** do Second Brain: só compensa quando o system prompt passar de alguns milhares de tokens. A v2 já deixa o conteúdo estável no começo e o variável (agenda, e-mails) no fim, para isso funcionar quando você quiser.
