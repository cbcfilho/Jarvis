# Teste do PROMPT_JARVIS_v2 (Parte 1)

**Resultado: 69/69 testes automatizados passaram** no Chromium 141 (headless), com o `jarvis.html` gerado a partir do prompt.

## Como foi feito

1. **Entrevista simulada.** Usei os padrões de personalidade (Jarvis, "senhor", azul reator, mordomo britânico, "Ei Jarvis", voz masculina) e uma pessoa **fictícia** no Second Brain: Lucas, 32 anos, dev em Curitiba, com metas, projetos, finanças, estudos, treino, esposa e sócio. O resultado foram 11 notas e 16 ligações.
2. **Geração.** Gerei o `jarvis.html` seguindo o prompt à risca, como uma sessão do Claude Code faria.
3. **Testes.** Rodei `run-tests.cjs` (Playwright). Microfone, voz e a API da Anthropic são **simulados**; nenhuma chamada real foi feita.

## O que foi verificado

| Área | Verificações |
|---|---|
| Telas | Boot (nome, "SINCRONIZANDO DADOS...", "v5.0 · REBUILD") → ativação após ~2,2 s → clique saúda e já começa a ouvir |
| Grafo | SVG via `innerHTML` de uma `<div>` com namespace correto, 11 nós / 16 arestas Bézier / 11 raios / 12 pulsos em movimento, animações, contador, legenda |
| API | Os 4 cabeçalhos, `model` lido de `CONFIG`, `max_tokens` 1024, `effort` "low", **sem** `thinking`, resposta lida mesmo com bloco `thinking` primeiro, system prompt completo, histórico limitado a 20 |
| Memória viva | `[[SAVE]]` cria a nota, pisca, mostra "desfazer", some do texto e da fala, e "desfazer" funciona. Tag cortada por `max_tokens` não é falada |
| Segurança | Título e resposta com `<img onerror>`/`<svg onload>` aparecem como texto e não executam. A CSP bloqueia o envio de dados para outro site. Nenhuma requisição saiu fora da API. O backup não contém a chave |
| Voz | Alias "Jarbas", comando na mesma frase, wake word sozinha → "Pois não?" com timeout de 8 s, frases sem wake word ignoradas, Jarvis não se ouve falando, volta a ouvir ~400 ms depois, interromper, pausar/retomar |
| Erros | 401, 400 sem crédito, 429, 529, 404, falha de rede, `refusal`, resposta vazia: mensagem certa, mostrada e falada. O histórico continua íntegro depois |
| Reconhecimento | Erro de rede → reinício com espera crescente. Microfone negado → para e explica |
| Dados | Primeira abertura salva o seed. Novo `SEED_ID` mescla sem perder notas aprendidas. Exportar/Importar (inclusive arquivo inválido). Editor: editar, criar com ligação, excluir |
| Celular | Sem rolagem horizontal, rótulos do grafo legíveis, layout troca ao redimensionar |

Capturas em `screenshots/`.

## O que o teste encontrou no prompt (já corrigido no v2)

1. **Grafo ilegível no celular.** Com o `viewBox` 1000×540 fixo, os rótulos ficavam com ~5 px numa tela de 390 px. O prompt agora pede um layout mais alto abaixo de 600 px (no teste: 18 px).
2. **O Jarvis não sabia a data nem a hora.** "Que horas são?" não tinha resposta. O system prompt agora termina com a data e a hora locais.
3. **"Jarbas"** é como o reconhecimento em pt-BR tende a escrever "Jarvis". Entrou na lista de exemplos de aliases.
4. **Saudação × microfone.** O microfone precisa ser ligado no clique (gesto do usuário) enquanto a saudação ainda toca. O prompt agora manda ignorar os resultados durante a saudação.

## Limites deste teste

- **Fala e microfone reais não foram testados.** Ainda falta confirmar num Chrome de verdade: a qualidade da voz pt-BR, o reconhecimento real e se o Chrome pergunta a permissão do microfone a cada reinício num arquivo aberto com dois cliques.
- **A API real não foi chamada** (não há chave neste ambiente). As respostas simuladas seguem o formato documentado da API.
- **Quem gerou o arquivo fui eu**, conhecendo a intenção do prompt. Uma sessão nova do Claude Code pode interpretar algum ponto de outro jeito. O teste mostra que o prompt é implementável e coerente, mas não garante o mesmo resultado em toda geração.

## Rodar de novo

```bash
cd teste-parte1
NODE_PATH=$(npm root -g) node run-tests.cjs
```
