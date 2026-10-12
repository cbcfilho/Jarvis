// Testes "caixa-preta" para QUALQUER jarvis.html gerado pelo PROMPT_JARVIS_v2 (Parte 1).
// Não depende de nomes internos: acha tudo pelo texto visível e observa o comportamento
// (requisições à API, o que é falado, localStorage, DOM).
// Uso: NODE_PATH=$(npm root -g) node blackbox-tests.cjs [caminho/jarvis.html]
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const HTML = path.resolve(process.argv[2] || path.join(__dirname, 'jarvis.html'));
const FILE = 'file://' + HTML;
const SHOTS = path.join(path.dirname(HTML), 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const SRC = fs.readFileSync(HTML, 'utf8');

const results = [];
function check(name, pass, detail) {
  const st = pass === null ? 'SKIP' : pass ? 'PASS' : 'FAIL';
  results.push({ name, status: st, detail: detail == null ? '' : String(detail).slice(0, 400) });
  console.log(st + '  ' + name + (detail ? '  — ' + String(detail).slice(0, 300) : ''));
}
async function step(name, fn) {
  try { await fn(); } catch (e) { check(name + ' (erro no teste)', false, e.message.split('\n')[0]); }
}

const INIT = () => {
  window.__spoken = [];
  window.__srAll = [];
  window.__srLog = [];
  window.__tts = { active: false, lastEnd: 0 };
  class FakeSR extends EventTarget {
    constructor() { super(); this.lang = ''; this.continuous = false; this.interimResults = true; this.started = false; window.__srAll.push(this); }
    _fire(type, props) {
      const e = new Event(type); Object.assign(e, props || {});
      const h = this['on' + type]; if (typeof h === 'function') h.call(this, e);
      this.dispatchEvent(e);
    }
    start() {
      if (this.started) throw new DOMException('recognition has already started', 'InvalidStateError');
      this.started = true; window.__srLog.push({ ev: 'start', t: Date.now() });
      setTimeout(() => { this._fire('start'); this._fire('audiostart'); }, 0);
    }
    stop() { if (!this.started) return; window.__srLog.push({ ev: 'stop', t: Date.now() }); this._end(); }
    abort() { if (!this.started) return; window.__srLog.push({ ev: 'abort', t: Date.now() }); this._end(); }
    _end() { this.started = false; setTimeout(() => this._fire('end'), 0); }
    _say(text) {
      if (!this.started) return false;
      const alt = { transcript: text, confidence: 0.9 };
      const r = [alt]; r.isFinal = true; r.item = i => r[i];
      const results = [r]; results.item = i => results[i];
      this._fire('result', { resultIndex: 0, results });
      return true;
    }
    _error(err) { this._fire('error', { error: err, message: err }); this._end(); }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
  window.SpeechSynthesisUtterance = class extends EventTarget {
    constructor(t) { super(); this.text = t || ''; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; this.volume = 1; }
  };
  let cur = null, pending = null;
  const fireU = (u, type) => { const e = new Event(type); e.utterance = u; const h = u['on' + type]; if (typeof h === 'function') h.call(u, e); u.dispatchEvent(e); };
  const synth = new EventTarget();
  Object.assign(synth, {
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    getVoices() { return [{ name: 'Google português do Brasil', lang: 'pt-BR', localService: false, default: false, voiceURI: 'g' },
                          { name: 'Daniel', lang: 'pt-BR', localService: true, default: false, voiceURI: 'd' }]; },
    speak(u) {
      if (cur) { this._queue = (this._queue || []).concat(u); return; }
      this._start(u);
    },
    _start(u) {
      window.__spoken.push(u.text); window.__voiceUsed = u.voice && u.voice.name;
      cur = u; this.speaking = true; window.__tts.active = true;
      setTimeout(() => fireU(u, 'start'), 0);
      pending = setTimeout(() => {
        if (cur !== u) return;
        cur = null; fireU(u, 'end');
        const next = (this._queue || []).shift();
        if (next) this._start(next); else { this.speaking = false; window.__tts.active = false; window.__tts.lastEnd = Date.now(); }
      }, window.__ttsMs || 40);
    },
    cancel() {
      clearTimeout(pending); this._queue = [];
      if (cur) { const u = cur; cur = null; setTimeout(() => fireU(u, 'error'), 0); }
      this.speaking = false; window.__tts.active = false; window.__tts.lastEnd = Date.now();
    },
    pause() { this.paused = true; }, resume() { this.paused = false; }
  });
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
};

const apiRequests = [];
let apiQueue = [];
let inflight = 0;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
const okText = (text, extra) => ({ status: 200, json: Object.assign({
  id: 'msg_t', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
  content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text }],
  stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }, extra || {}) });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(INIT);
  await ctx.route('https://api.anthropic.com/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    inflight++;
    let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (e) { /* */ }
    apiRequests.push({ headers: req.headers(), body });
    const next = apiQueue.shift() || okText('Certamente, senhor.');
    await new Promise(r => setTimeout(r, 60));
    inflight--;
    if (next.abort) return route.abort('failed');
    return route.fulfill({ status: next.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS), body: JSON.stringify(next.json) });
  });
  const outside = [];
  await ctx.route(u => !/^(file:|data:|blob:|https:\/\/api\.anthropic\.com)/.test(u.href), r => { outside.push(r.request().url()); r.abort(); });

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => d.accept());
  const ev = (fn, a) => page.evaluate(fn, a);

  // Ocioso = sem requisição em andamento e sem fala por 600 ms seguidos (cobre a pausa entre frases).
  const waitIdle = async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const st = await ev(() => ({ a: window.__tts.active, since: Date.now() - window.__tts.lastEnd }));
      if (inflight === 0 && !st.a && st.since >= 600) break;
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(150);
  };
  const micOn = () => ev(() => window.__srAll.some(s => s.started));
  const say = async (text, noWait) => {
    if (!noWait) await page.waitForFunction(() => window.__srAll.some(s => s.started), null, { timeout: 5000 });
    return ev(t => { const s = [...window.__srAll].reverse().find(x => x.started); return s ? s._say(t) : false; }, text);
  };
  const visibleText = () => ev(() => document.body.innerText);
  const textInput = () => page.locator('input[placeholder*="digite" i]').first();
  const sendText = async t => { const i = textInput(); await i.fill(t); await i.press('Enter'); };
  const notesLS = () => ev(() => { try { return JSON.parse(localStorage.getItem('jarvis_notes')); } catch (e) { return null; } });
  const clickByText = async (re, opts) => {
    const loc = page.locator('button, [role="button"], a, span, div, li').filter({ hasText: re });
    const n = await loc.count();
    for (let i = n - 1; i >= 0; i--) { const el = loc.nth(i); if (await el.isVisible()) { await el.click(opts); return true; } }
    return false;
  };

  // ── Análise estática ──
  check('Código: não usa data.content[0].text', !/content\[0\]\.text/.test(SRC));
  check('Código: sem eval / new Function', !/\beval\s*\(|new Function\s*\(/.test(SRC));
  check('Código: sem CDN/fonte externa (<script src>/<link href http>)', !/<script[^>]+src=|<link[^>]+href=["']https?:/i.test(SRC));
  check('Código: modelo claude-sonnet-5-5 e effort "low" em CONFIG', /claude-sonnet-5-5/.test(SRC) && /effort\s*:\s*["']low["']/.test(SRC));
  check('Código: função esc() presente', /function\s+esc\s*\(|const\s+esc\s*=|let\s+esc\s*=/.test(SRC));

  await step('Boot', async () => {
    await page.goto(FILE);
    await page.waitForTimeout(300);
    const t = await visibleText();
    check('Boot: "SINCRONIZANDO DADOS..." e "v5.0 · REBUILD" visíveis', /SINCRONIZANDO DADOS/.test(t) && /v5\.0\s*·\s*REBUILD/.test(t), t.replace(/\s+/g, ' ').slice(0, 120));
    await page.screenshot({ path: path.join(SHOTS, '1-boot.png') });
    const metaOk = await ev(() => {
      const m = document.querySelector('meta[http-equiv="Content-Security-Policy" i]');
      const kids = [...document.head.children];
      const iCharset = kids.findIndex(k => k.tagName === 'META' && k.hasAttribute('charset'));
      return { content: m && m.getAttribute('content'), right: m && kids.indexOf(m) === iCharset + 1 };
    });
    check('CSP exatamente como pedido, logo depois do <meta charset>',
      metaOk.content === "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src https://api.anthropic.com; base-uri 'none'; form-action 'none'" && metaOk.right,
      JSON.stringify(metaOk));
  });

  await step('Ativação', async () => {
    const btn = page.getByText(/ATIVAR SISTEMA/).first();
    await page.waitForTimeout(1000);
    check('Ativação ainda não aparece com ~1,3 s', !(await btn.isVisible()));
    await page.waitForTimeout(1700);
    check('Ativação aparece (~2,2 s) com "► ATIVAR SISTEMA" e "CLIQUE PARA INICIAR"', await btn.isVisible() && /CLIQUE PARA INICIAR/.test(await visibleText()));
    await page.screenshot({ path: path.join(SHOTS, '2-ativacao.png') });
    await btn.click();
    await page.waitForTimeout(500);
    const sp = (await ev(() => window.__spoken)).join(' ');
    check('Clique em ATIVAR: saúda "Sistemas online. Estou ouvindo, senhor."', /Sistemas online/i.test(sp) && /ouvindo,?\s*senhor/i.test(sp), sp);
    const sr = await ev(() => window.__srAll.map(s => ({ lang: s.lang, c: s.continuous, i: s.interimResults, st: s.started })));
    check('Clique em ATIVAR: reconhecimento iniciado (pt-BR, continuous, sem interim)',
      sr.some(s => s.lang === 'pt-BR' && s.c === true && s.i === false) && (await ev(() => window.__srLog.some(x => x.ev === 'start'))), JSON.stringify(sr));
    check('Voz masculina pt-BR escolhida', (await ev(() => window.__voiceUsed)) === 'Daniel', await ev(() => window.__voiceUsed));
    await waitIdle();
    check('Indicador "OUVINDO" visível com microfone ativo', (await micOn()) && /OUVINDO/.test(await visibleText()));
  });

  let embedded = [];
  await step('Grafo', async () => {
    embedded = (await notesLS()) || [];
    const g = await ev(() => {
      const svg = [...document.querySelectorAll('svg')].find(s => s.querySelectorAll('circle').length > 5);
      if (!svg) return null;
      const ns = JSON.parse(localStorage.getItem('jarvis_notes') || '[]');
      const texts = [...svg.querySelectorAll('text')].map(t => t.textContent.trim());
      const edges = [...svg.querySelectorAll('path')].filter(p => /Q/i.test(p.getAttribute('d') || ''));
      const pos = () => [...svg.querySelectorAll('circle')].map(c => (c.getAttribute('cx') || '') + ',' + (c.getAttribute('cy') || '') + (c.getAttribute('transform') || ''));
      return {
        parent: svg.parentElement.tagName, ns: svg.namespaceURI, circleIsSvg: svg.querySelector('circle') instanceof SVGCircleElement,
        h: svg.getBoundingClientRect().height, allTitles: ns.every(n => texts.includes(n.title)), notes: ns.length,
        edges: edges.length, rel: JSON.parse(localStorage.getItem('jarvis_rel') || '[]').length, pos0: pos(),
        dash0: edges[0] ? getComputedStyle(edges[0]).strokeDashoffset : null, dashArr: edges[0] ? getComputedStyle(edges[0]).strokeDasharray : null,
        seed: localStorage.getItem('jarvis_seed'), hasBrain: svg.textContent.includes('🧠')
      };
    });
    if (!g) { check('Grafo SVG encontrado', false); return; }
    check('Grafo: <svg> dentro de uma DIV, namespace SVG correto, visível', g.parent === 'DIV' && g.ns === 'http://www.w3.org/2000/svg' && g.circleIsSvg && g.h > 100, JSON.stringify({ p: g.parent, h: Math.round(g.h) }));
    check('Grafo: um nó (com rótulo) por nota e núcleo 🧠', g.allTitles && g.notes >= 8 && g.hasBrain, 'notas=' + g.notes);
    check('Grafo: arestas Bézier quadráticas, pelo menos uma por relação', g.edges >= g.rel && g.rel > 0, 'arestas=' + g.edges + ' relações=' + g.rel);
    check('localStorage: jarvis_notes, jarvis_rel e jarvis_seed gravados na 1ª abertura', g.notes > 0 && g.rel > 0 && !!g.seed, 'seed=' + g.seed);
    await page.waitForTimeout(600);
    const g2 = await ev(() => {
      const svg = [...document.querySelectorAll('svg')].find(s => s.querySelectorAll('circle').length > 5);
      const edges = [...svg.querySelectorAll('path')].filter(p => /Q/i.test(p.getAttribute('d') || ''));
      return { pos: [...svg.querySelectorAll('circle')].map(c => (c.getAttribute('cx') || '') + ',' + (c.getAttribute('cy') || '') + (c.getAttribute('transform') || '')),
        dash: edges[0] ? getComputedStyle(edges[0]).strokeDashoffset : null };
    });
    const moved = g2.pos.filter((p, i) => p !== g.pos0[i]).length;
    check('Pulsos de sinapse se movendo (≥ 8 pontos mudaram de posição)', moved >= 8, moved + ' círculos se moveram');
    check('Arestas com traço deslizando (dasharray + dashoffset mudando)', g.dashArr && g.dashArr !== 'none' && g.dash0 !== g2.dash, g.dashArr + ' | ' + g.dash0 + ' → ' + g2.dash);
    const t = await visibleText();
    const nAreas = new Set(embedded.map(n => n.area)).size;
    check('Contador "N notas · M áreas" correto', new RegExp(embedded.length + '\\s*notas\\s*·\\s*' + nAreas + '\\s*áreas').test(t), embedded.length + ' notas · ' + nAreas + ' áreas');
    check('Legenda: "✓ contexto injetado em todos os comandos do Jarvis"', /contexto injetado em todos os comandos do Jarvis/i.test(t));
    await page.screenshot({ path: path.join(SHOTS, '3-app-desktop.png'), fullPage: true });
  });

  await step('Sem chave', async () => {
    const before = apiRequests.length;
    const sp0 = await ev(() => window.__spoken.length);
    await sendText('olá');
    await waitIdle();
    const sp = (await ev(n => window.__spoken.slice(n).join(' '), sp0));
    check('Sem chave: pede para colar (falado), sem chamar a API', apiRequests.length === before && /chave/i.test(sp), sp);
  });

  const KEY = 'sk-ant-api03-TESTE-wxyz9876';
  await step('Chave', async () => {
    const pw = page.locator('input[type="password"]').first();
    check('Campo da chave é do tipo password', await pw.isVisible());
    await pw.fill(KEY);
    let clicked = false;
    const near = page.locator('button').filter({ hasText: /salvar|ok|usar|✓|guardar/i });
    for (let i = 0; i < await near.count(); i++) { if (await near.nth(i).isVisible()) { await near.nth(i).click(); clicked = true; break; } }
    if (!clicked) await pw.press('Enter');
    await page.waitForTimeout(300);
    const stored = await ev(() => localStorage.getItem('anthropic_key'));
    const t = await ev(() => document.body.innerText + ' ' + [...document.querySelectorAll('input')].map(i => i.value).join(' '));
    check('Chave salva em localStorage "anthropic_key"', stored === KEY);
    check('Tela mostra só os 4 últimos caracteres da chave', t.includes('9876') && !t.includes(KEY), t.match(/.{0,20}9876/) ? t.match(/.{0,20}9876/)[0] : '');
  });

  await step('Chamada feliz por voz', async () => {
    apiQueue.push(okText('Excelente iniciativa, senhor. Japonês combina com seus planos de viagem.\n[[SAVE:aprendizado|Japonês|Começou a estudar japonês para viajar com a Ana.]]'));
    await ev(() => { window.__ttsMs = 1200; });
    const before = apiRequests.length;
    const ok = await say('E aí Jarbas, comecei a estudar japonês');
    await page.waitForFunction(() => window.__spoken.some(s => /Excelente iniciativa/.test(s)), null, { timeout: 8000 });
    await page.waitForTimeout(200);
    const accepted = await say('jarvis, isso não pode ser ouvido', true);
    const stoppedDuringTTS = !(await micOn()) || accepted === false;
    await waitIdle();
    await ev(() => { window.__ttsMs = 40; });
    const r = apiRequests[before];
    const last = r && r.body.messages[r.body.messages.length - 1];
    const lastText = last && (typeof last.content === 'string' ? last.content : (last.content || []).map(b => b.text || '').join(''));
    check('Wake word por alias "Jarbas" + comando na mesma frase', ok && r && /comecei a estudar japon/i.test(lastText) && !/jarbas/i.test(lastText), lastText);
    check('4 cabeçalhos da API', r && r.headers['x-api-key'] === KEY && r.headers['anthropic-version'] === '2023-06-01' &&
      r.headers['anthropic-dangerous-direct-browser-access'] === 'true' && /application\/json/.test(r.headers['content-type'] || ''));
    check('Corpo: model claude-sonnet-5-5, max_tokens 1024, output_config.effort low, SEM thinking',
      r && r.body.model === 'claude-sonnet-5-5' && r.body.max_tokens === 1024 && r.body.output_config && r.body.output_config.effort === 'low' && !('thinking' in r.body),
      r && JSON.stringify({ m: r.body.model, t: r.body.max_tokens, o: r.body.output_config, th: 'thinking' in r.body }));
    const sys = r && (typeof r.body.system === 'string' ? r.body.system : JSON.stringify(r.body.system));
    check('System prompt: Second Brain inteiro + protocolo [[SAVE]]', sys && embedded.every(n => sys.includes(n.title)) && sys.includes('[[SAVE:'), (sys || '').slice(0, 120));
    const tail = (sys || '').slice(-250);
    check('System prompt termina com data e hora atuais', /20\d\d/.test(tail) && /\d{1,2}[:h]\d{2}/.test(tail), tail);
    const t = await visibleText();
    const spoken = (await ev(() => window.__spoken.join(' || ')));
    check('Resposta lida mesmo com bloco "thinking" primeiro', /Excelente iniciativa/.test(t));
    check('[[SAVE]] some da tela e da fala', !/\[\[SAVE/.test(t) && !/\[\[SAVE/.test(spoken));
    check('Não se ouve falando: frase com wake word durante a fala é ignorada', stoppedDuringTTS && apiRequests.length === before + 1, 'accepted=' + accepted + ' reqs=' + (apiRequests.length - before));
    const ns = await notesLS();
    const jp = ns && ns.find(n => n.title === 'Japonês');
    check('Memória viva: nota "Japonês" criada na área aprendizado', jp && jp.area === 'aprendizado', JSON.stringify(jp));
    check('Memória viva: aviso "memória salva" com "desfazer"', /memória salva/i.test(t) && /desfazer/i.test(t));
    const back = await page.waitForFunction(() => window.__srAll.some(s => s.started), null, { timeout: 3000 }).then(() => true, () => false);
    check('Depois da fala, volta a ouvir sozinho', back);
    const undone = await clickByText(/^\s*desfazer\s*$/i) || await clickByText(/desfazer/i);
    await page.waitForTimeout(300);
    const ns2 = await notesLS();
    check('"desfazer" remove a memória recém-salva', undone && ns2 && !ns2.some(n => n.title === 'Japonês'), 'clicou=' + undone);
  });

  await step('XSS', async () => {
    apiQueue.push(okText('Feito <b>x</b><img src=x onerror="window.__pwned2=1">, senhor.\n[[SAVE:metas|<img src=x onerror=window.__pwned=1>|<svg onload=window.__pwned3=1>]]'));
    await sendText('teste de segurança');
    await waitIdle();
    const x = await ev(() => ({ p: [window.__pwned, window.__pwned2, window.__pwned3], imgs: document.querySelectorAll('img').length,
      label: [...document.querySelectorAll('svg text')].some(t => t.textContent.includes('<img src=x')) }));
    check('XSS: título e resposta maliciosos não executam (aparecem como texto)', x.p.every(v => v === undefined) && x.imgs === 0 && x.label, JSON.stringify(x));
  });

  await step('Editor', async () => {
    const clickNode = async title => {
      const box = await ev(t => {
        const svg = [...document.querySelectorAll('svg')].find(s => s.querySelectorAll('circle').length > 5);
        const txt = [...svg.querySelectorAll('text')].find(e => e.textContent.trim() === t);
        if (!txt) return null;
        const tb = txt.getBoundingClientRect();
        let best = null, bd = 1e9;
        for (const c of svg.querySelectorAll('circle')) {
          const b = c.getBoundingClientRect(); if (b.width < 6) continue;
          const d = Math.hypot(b.x + b.width / 2 - (tb.x + tb.width / 2), b.y + b.height / 2 - tb.y);
          if (d < bd && b.y < tb.y) { bd = d; best = b; }
        }
        return best && { x: best.x + best.width / 2, y: best.y + best.height / 2 };
      }, title);
      if (!box) return false;
      await page.mouse.click(box.x, box.y);
      await page.waitForTimeout(300);
      return ev(t => [...document.querySelectorAll('input, textarea')].some(i => i.offsetParent !== null && i.value === t), title);
    };
    const xssTitle = '<img src=x onerror=window.__pwned=1>';
    const opened = await clickNode(xssTitle);
    check('Clique no nó abre o editor com o título da nota', opened);
    if (opened) {
      const del = await clickByText(/excluir/i);
      await page.waitForTimeout(300);
      check('Editor: Excluir remove a nota', del && !(await notesLS()).some(n => n.title === xssTitle));
    }
    const target = embedded[0];
    if (target && await clickNode(target.title)) {
      const ta = page.locator('textarea').filter({ visible: true }).first();
      await ta.fill('Conteúdo editado pelo teste.');
      await clickByText(/salvar/i);
      await page.waitForTimeout(300);
      check('Editor: salvar grava no localStorage', (await notesLS()).find(n => n.title === target.title).body === 'Conteúdo editado pelo teste.');
    } else check('Editor: salvar grava no localStorage', null, 'não consegui abrir o editor da nota ' + (target && target.title));
    const plus = page.locator('button').filter({ hasText: /^\s*\+\s*$/ }).first();
    if (await plus.count() && await plus.isVisible()) {
      await plus.click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, '5-editor.png') });
      const ti = page.locator('input[type="text"], input:not([type])').filter({ visible: true });
      let filled = false;
      for (let i = 0; i < await ti.count(); i++) {
        const ph = (await ti.nth(i).getAttribute('placeholder')) || '';
        if (/digite|chave|sk-ant/i.test(ph)) continue;
        await ti.nth(i).fill('Violão'); filled = true; break;
      }
      const ta = page.locator('textarea').filter({ visible: true }).first();
      if (await ta.count()) await ta.fill('Quer aprender violão.');
      await clickByText(/salvar/i);
      await page.waitForTimeout(300);
      const ns = await notesLS();
      check('"+" cria nota nova e o contador atualiza', filled && ns.some(n => n.title === 'Violão') && new RegExp(ns.length + '\\s*notas').test(await visibleText()), 'notas=' + ns.length);
    } else check('"+" cria nota nova', null, 'botão "+" não encontrado');
  });

  await step('Wake word em duas etapas', async () => {
    const before = apiRequests.length;
    await say('vamos almoçar mais tarde?');
    await page.waitForTimeout(400);
    check('Frase sem wake word é ignorada', apiRequests.length === before);
    await say('Ei, Jarvis.');
    await page.waitForTimeout(300);
    apiQueue.push(okText('São quatro da tarde, senhor.'));
    await say('que horas são');
    await waitIdle();
    const r = apiRequests[apiRequests.length - 1];
    const last = r && r.body.messages[r.body.messages.length - 1];
    const lt = last && (typeof last.content === 'string' ? last.content : (last.content || []).map(b => b.text || '').join(''));
    check('Só a wake word → a próxima frase vira comando', apiRequests.length === before + 1 && /que horas s/i.test(lt), lt);
  });

  await step('Erros', async () => {
    const cases = [
      ['401', { status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }, /inválid/i],
      ['400 crédito', { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } } }, /crédito/i],
      ['429', { status: 429, json: { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } } }, /limite/i],
      ['529', { status: 529, json: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }, /ocupad/i],
      ['404 (outro)', { status: 404, json: { type: 'error', error: { type: 'not_found_error', message: 'x' } } }, /404/],
      ['rede', { abort: true }, /conect/i],
      ['refusal', { status: 200, json: { type: 'message', role: 'assistant', content: [], stop_reason: 'refusal' } }, /não posso ajudar/i],
      ['resposta vazia', { status: 200, json: { type: 'message', role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 's' }], stop_reason: 'end_turn' } }, /vazi|não (recebi|entendi|veio)|erro|sem resposta/i]
    ];
    for (const [name, resp, re] of cases) {
      const sp0 = await ev(() => window.__spoken.length);
      apiQueue.push(resp);
      await sendText('teste ' + name);
      await waitIdle();
      const sp = await ev(n => window.__spoken.slice(n).join(' '), sp0);
      const shown = re.test(await visibleText());
      check('Erro ' + name + ': mostrado e falado', re.test(sp) && shown, sp);
    }
    apiQueue.push(okText('Tudo certo, senhor.'));
    await sendText('depois dos erros');
    await waitIdle();
    const m = apiRequests[apiRequests.length - 1].body.messages;
    check('Depois dos erros o histórico segue alternando user/assistant', m[0].role === 'user' && m.every((x, i) => x.role === (i % 2 ? 'assistant' : 'user')), m.map(x => x.role[0]).join(''));
  });

  await step('Tag cortada', async () => {
    const sp0 = await ev(() => window.__spoken.length);
    apiQueue.push(okText('Certo, senhor. Vou lembrar disso. [[SAVE:metas|Viagem|Ir ao Japão em', { stop_reason: 'max_tokens' }));
    await sendText('quero ir ao Japão');
    await waitIdle();
    const sp = await ev(n => window.__spoken.slice(n).join(' '), sp0);
    check('max_tokens: usa o texto que veio e não fala a tag cortada', /Vou lembrar disso/.test(sp) && !/\[\[|SAVE/.test(sp), sp);
  });

  await step('Histórico', async () => {
    for (let i = 0; i < 13; i++) { apiQueue.push(okText('Resposta ' + i + ', senhor.')); await sendText('pergunta ' + i); await waitIdle(); }
    const m = apiRequests[apiRequests.length - 1].body.messages;
    check('Histórico limitado a 20 mensagens, começando por user', m.length <= 20 && m[0].role === 'user', 'enviadas=' + m.length);
  });

  await step('Interromper', async () => {
    await ev(() => { window.__ttsMs = 4000; });
    apiQueue.push(okText('Resposta longa para interromper, senhor.'));
    await sendText('fale bastante');
    await page.waitForFunction(() => window.__tts.active && window.__spoken.some(s => /interromper/.test(s)), null, { timeout: 8000 });
    const btn = page.locator('button').filter({ hasText: /■|⏹|◼|parar|interromp|stop/i });
    let clicked = false;
    for (let i = 0; i < await btn.count(); i++) if (await btn.nth(i).isVisible()) { await btn.nth(i).click(); clicked = true; break; }
    if (!clicked) {
      const alt = page.locator('button[title*="interromp" i], button[aria-label*="interromp" i], button[title*="parar" i], button[aria-label*="parar" i]').first();
      if (await alt.count()) { await alt.click(); clicked = true; }
    }
    await page.waitForTimeout(300);
    check('Botão interromper corta a fala', clicked && !(await ev(() => window.__tts.active)), 'clicou=' + clicked);
    await ev(() => { window.__ttsMs = 40; });
    await page.waitForTimeout(1200);
  });

  await step('Erros do reconhecimento', async () => {
    await page.waitForFunction(() => window.__srAll.some(s => s.started), null, { timeout: 5000 });
    await ev(() => { window.__srLog.length = 0; });
    const tErr1 = Date.now();
    await ev(() => [...window.__srAll].reverse().find(s => s.started)._error('network'));
    await page.waitForFunction(() => window.__srAll.some(s => s.started), null, { timeout: 5000 });
    const gap1 = Date.now() - tErr1;
    const tErr2 = Date.now();
    await ev(() => [...window.__srAll].reverse().find(s => s.started)._error('network'));
    await page.waitForFunction(() => window.__srAll.some(s => s.started), null, { timeout: 8000 });
    const gap2 = Date.now() - tErr2;
    check('Erro de rede: reinicia com espera crescente (sem loop apertado)', gap1 >= 700 && gap2 > gap1 * 1.4, 'esperas ≈ ' + gap1 + ' ms, ' + gap2 + ' ms');
    await ev(() => [...window.__srAll].reverse().find(s => s.started)._error('not-allowed'));
    await page.waitForTimeout(2500);
    check('Microfone negado: para de reiniciar e explica na tela', !(await micOn()) && /microfone/i.test(await visibleText()));
  });

  await step('Exportar/Importar', async () => {
    let item = page.getByText(/Exportar mem/i).first();
    if (!(await item.isVisible().catch(() => false))) {
      const toggles = page.locator('button').filter({ hasText: /^\s*(⋯|…|\.\.\.|☰|≡|⋮|⚙|menu)\s*$/i });
      for (let i = 0; i < await toggles.count() && !(await item.isVisible()); i++) if (await toggles.nth(i).isVisible()) { await toggles.nth(i).click(); await page.waitForTimeout(200); }
      if (!(await item.isVisible())) {
        const aria = page.locator('button[aria-haspopup], button[title*="menu" i], button[aria-label*="menu" i], button[title*="opç" i], button[aria-label*="opç" i], button[title*="mais" i]');
        for (let i = 0; i < await aria.count() && !(await item.isVisible()); i++) if (await aria.nth(i).isVisible()) { await aria.nth(i).click(); await page.waitForTimeout(200); }
      }
    }
    if (!(await item.isVisible())) { check('Exportar memórias', null, 'não achei o item de menu'); return; }
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), item.click()]);
    const txt = fs.readFileSync(await dl.path(), 'utf8');
    let j = null; try { j = JSON.parse(txt); } catch (e) { /* */ }
    check('Exportar: baixa jarvis-backup.json com as notas', dl.suggestedFilename() === 'jarvis-backup.json' && j && JSON.stringify(j).includes('Violão'), dl.suggestedFilename());
    check('Exportar: backup NÃO contém a chave', !txt.includes('sk-ant') && !txt.includes('9876'));
    const f = path.join(os.tmpdir(), 'bb-import.json');
    const sample = Object.assign({}, j || {}, { notes: ((j && (j.notes || j.NOTES)) || []).concat([{ id: 'imp1', area: 'invalida', title: 'Podcast', body: 'Lançar um podcast.' }]) });
    fs.writeFileSync(f, JSON.stringify(sample));
    const fileIn = page.locator('input[type="file"]').first();
    if (!(await fileIn.count())) { check('Importar memórias', null, 'sem <input type=file>'); return; }
    await fileIn.setInputFiles(f);
    await page.waitForTimeout(600);
    const ns = await notesLS();
    const pod = ns.find(n => n.title === 'Podcast');
    check('Importar: mescla nota nova e valida a área (inválida → meta)', pod && pod.area === 'meta', JSON.stringify(pod));
    fs.writeFileSync(f, 'não é json');
    await fileIn.setInputFiles(f);
    await page.waitForTimeout(500);
    check('Importar arquivo inválido não quebra a página', pageErrors.length === 0, pageErrors.join(' | '));
  });

  await step('SEED_ID', async () => {
    await ev(() => {
      const ns = JSON.parse(localStorage.getItem('jarvis_notes'));
      const one = ns[0];
      localStorage.setItem('jarvis_notes', JSON.stringify([{ id: 'learned1', area: 'metas', title: 'Maratona', body: 'Correr uma maratona.' },
        { id: one.id, area: one.area, title: one.title, body: 'Versão aprendida.' }]));
      localStorage.setItem('jarvis_rel', '[]');
      localStorage.setItem('jarvis_seed', 'seed-antigo');
    });
    await page.reload();
    await page.waitForTimeout(500);
    const ns = await notesLS();
    const one = ns && ns.find(n => n.title === embedded[0].title);
    check('Novo SEED_ID: embutidas entram, aprendidas ficam, sem duplicar título',
      ns && ns.some(n => n.title === 'Maratona') && one && one.body === 'Versão aprendida.' && embedded.every(e => ns.some(n => n.title === e.title)) &&
      ns.filter(n => n.title === embedded[0].title).length === 1 && (await ev(() => localStorage.getItem('jarvis_seed'))) !== 'seed-antigo',
      'notas=' + (ns && ns.length));
  });

  await step('CSP', async () => {
    const r = await ev(async () => { const b = window.__csp.length; let blocked = false; try { await fetch('https://evil.example/x'); } catch (e) { blocked = true; } await new Promise(z => setTimeout(z, 100)); return { blocked, v: window.__csp.slice(b) }; });
    check('CSP bloqueia envio para outro site', r.blocked && r.v.some(v => v.startsWith('connect-src')), JSON.stringify(r.v));
    check('Nenhuma requisição de rede para fora da API', outside.length === 0, outside.join(', '));
  });

  await step('Celular', async () => {
    const mob = await ctx.newPage();
    mob.on('pageerror', e => pageErrors.push('mobile: ' + e.message));
    await mob.setViewportSize({ width: 390, height: 844 });
    await mob.goto(FILE);
    await mob.waitForTimeout(2800);
    await mob.getByText(/ATIVAR SISTEMA/).first().click();
    await mob.waitForTimeout(800);
    const o = await mob.evaluate(() => {
      const svg = [...document.querySelectorAll('svg')].find(s => s.querySelectorAll('circle').length > 5);
      const ns = JSON.parse(localStorage.getItem('jarvis_notes') || '[]');
      const t = svg && [...svg.querySelectorAll('text')].find(e => ns.some(n => n.title === e.textContent.trim()));
      return { sw: document.documentElement.scrollWidth, w: innerWidth, label: t ? Math.round(t.getBoundingClientRect().height) : 0 };
    });
    check('Celular (390 px): sem rolagem horizontal', o.sw <= o.w, JSON.stringify(o));
    check('Celular: rótulos do grafo legíveis (≥ 11 px)', o.label >= 11, o.label + ' px');
    await mob.screenshot({ path: path.join(SHOTS, '4-app-mobile.png'), fullPage: true });
  });

  check('Nenhuma exceção de JavaScript', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  const c = s => results.filter(r => r.status === s).length;
  console.log('\n' + c('PASS') + ' PASS · ' + c('FAIL') + ' FAIL · ' + c('SKIP') + ' SKIP (de ' + results.length + ')');
  fs.writeFileSync(path.join(path.dirname(HTML), 'resultados-blackbox.json'), JSON.stringify(results, null, 2));
})().catch(e => { console.error(e); process.exit(2); });
