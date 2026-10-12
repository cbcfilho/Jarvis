# Teste com sessão independente — PROMPT_JARVIS_v2 (Parte 1)

**Resultado: 68/68 testes caixa-preta passaram** no `jarvis.html` gerado por uma sessão nova do Claude Code, que não tinha visto nada desta conversa.

## Como foi feito

| Item | Detalhe |
|---|---|
| Sessão | Claude Code na nuvem, criada do zero (`session_017ppoQUTEHsXLM6XsH7LubV`), modelo `claude-opus-5-5`, **sem repositório**: pasta vazia, sem acesso à minha versão nem aos testes |
| Prompt | O texto do `PROMPT_JARVIS_v2.txt` a partir de `# PAPEL`, colado como primeira mensagem |
| Entrevista | Respondida por mim no papel do usuário: "padrão em tudo" na personalidade e o mesmo Lucas fictício nas 8 áreas, **uma área por mensagem** |
| Duração / custo | ~13 min, ~US$ 2,82 (entrevista + geração + autoteste da própria sessão) |
| Arquivo | Extraído da chamada `Write` registrada no histórico da sessão. Depois do `Write` não houve nenhum `Edit` nem comando que alterasse o arquivo, então a cópia é exata (57.489 caracteres, sha256 `a1675557…a455c`) |

## Como a sessão seguiu o prompt

- ✅ Abriu com a frase exata ("Boa! Vou te fazer algumas perguntas…") e fez **uma pergunta por vez**.
- ✅ Entendeu "padrão em tudo", aplicou os 6 padrões e foi para a Etapa 2.
- ✅ Leu o aviso de privacidade antes do Second Brain e lembrou de não compartilhar o arquivo no fechamento.
- ✅ Criou 12 notas, separando corretamente vários itens (2 projetos, 3 de aprendizado) e mostrou o resumo com "Confirma que posso gerar seu Jarvis com isso?".
- ✅ Não escreveu código antes da confirmação. Depois salvou como `jarvis.html` e entregou o passo a passo e os 3 avisos de privacidade.
- ✅ Por conta própria, testou o arquivo num Chromium headless antes de entregar.
- ⚠️ Pequeno desvio: o título "Treino e Sono" tem 3 palavras (o prompt pede 1–2).

## O que os testes caixa-preta verificaram

Os testes não dependem de nomes internos. Eles acham os elementos pelo texto visível e observam o comportamento: requisições à API, o que é falado e o `localStorage`. A mesma bateria passa 68/68 na minha versão (`teste-parte1/`) e na da sessão independente.

| Área | Resultado |
|---|---|
| CSP exata logo após o `<meta charset>`, sem CDN, sem `eval`, sem `content[0].text`, com `esc()` | ✅ |
| Boot → ativação (~2,2 s) → saudação falada + microfone ligado (pt-BR, contínuo) | ✅ |
| Grafo: SVG dentro de `<div>`, 12 nós com rótulo, 25 arestas Bézier, pulsos e tracejado animados, contador e legenda | ✅ |
| API: 4 cabeçalhos, `claude-sonnet-5-5`, `max_tokens` 1024, `effort` low, sem `thinking`, data/hora no fim do system prompt | ✅ |
| Resposta com bloco `thinking` primeiro; `[[SAVE]]` cria nota, some da fala e da tela; "desfazer" | ✅ |
| XSS por título/resposta maliciosos; CSP bloqueia envio para outro site | ✅ |
| Wake word: alias "Jarbas" + comando na mesma frase, só o nome → próxima frase, frase sem nome ignorada, não se ouve falando | ✅ |
| Erros 401 / crédito / 429 / 529 / 404 / rede / recusa / resposta vazia: mostrados e falados; histórico íntegro | ✅ |
| Histórico ≤ 20, tag cortada não falada, botão interromper, espera crescente no erro de rede, microfone negado | ✅ |
| Editor (abrir pelo nó, editar, excluir, "+"), Exportar sem a chave, Importar (área inválida → meta, arquivo inválido) | ✅ |
| `SEED_ID` novo mescla sem perder memórias; celular sem rolagem e com rótulos legíveis | ✅ |

## Diferenças entre as duas versões (as duas atendem ao prompt)

- **Mensagem de erro de resposta vazia:** "A resposta veio sem texto…" na versão independente, "Recebi uma resposta vazia…" na minha. O prompt não fixa o texto.
- **Microfone durante a fala:** a minha versão pausa o reconhecimento; a independente o mantém ligado e ignora o que ouvir. O prompt aceita as duas formas.
- **Rótulos longos:** a versão independente abrevia com "…" no grafo.
- **Texto digitado durante "ocupado":** a versão independente descarta o Enter em silêncio, deixando o texto no campo. A minha avisa "Um momento…". Isso virou uma linha nova no prompt v2.

## Ajustes nos testes durante esta rodada

A primeira execução deu 55/68, mas todas as falhas vinham dos **testes**, não do arquivo:

- o teste checava o resultado antes de a requisição chegar ao mock;
- digitava dentro da janela de 400 ms em que a app ainda está ocupada;
- procurava o título completo num rótulo abreviado;
- usava uma regex estreita demais para a mensagem de resposta vazia.

Depois das correções, as duas versões passam 68/68.

## Limites

- **Voz e microfone reais**, e uma **chamada de verdade à API**, continuam sem teste (não há microfone nem chave neste ambiente). A própria sessão independente apontou o mesmo.
- **Uma geração só:** outra rodada pode sair diferente. Repetir algumas vezes, ou com outro modelo (ex.: o padrão Sonnet), daria uma ideia melhor da variação.

## Rodar de novo

```bash
cd teste-parte1-sessao-nova
NODE_PATH=$(npm root -g) node blackbox-tests.cjs jarvis.html
```
