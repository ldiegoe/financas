// Player de treino em tela cheia.
//
// Três problemas práticos que um timer de treino precisa resolver, e que são a
// razão de este arquivo existir em vez de um setInterval solto:
//
// 1. DRIFT — o tempo NUNCA é acumulado. Cada quadro calcula
//    `(agora - inicio - pausado)` e pergunta ao domínio que fase é essa. Somar
//    1s por tick erraria vários segundos ao longo de um treino de 20 minutos.
// 2. TELA APAGANDO — Wake Lock mantém o aparelho aceso. Ele é PERDIDO quando o
//    app vai pro segundo plano, então re-adquirimos no visibilitychange.
// 3. ÁUDIO NO iOS — o AudioContext nasce suspenso e só pode ser destravado
//    dentro de um gesto do usuário. Por isso `destravar()` roda no toque que
//    inicia o treino, e não na montagem da tela.
//
// Vibração não entra: `navigator.vibrate` não existe no Safari do iOS, que é
// justamente o aparelho do usuário. O aviso é sonoro.

import { construirLinha, duracaoTotal, faseEm, inicioDaFase, fmtMMSS } from '../domain/treino.js';

// --- áudio -----------------------------------------------------------------
const criarAudio = () => {
  let ctx = null;
  const destravar = () => {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch { ctx = null; }
  };
  const bip = (freq, dur = 0.12, vol = 0.35) => {
    if (!ctx || ctx.state !== 'running') return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Rampa exponencial em vez de corte seco: corte gera um "clique" audível.
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch {}
  };
  return {
    destravar,
    contagem: () => bip(880, 0.09),             // 3...2...1
    comecar:  () => bip(1320, 0.18, 0.4),       // vai!
    parar:    () => bip(520, 0.22, 0.35),       // intervalo/descanso
    fim:      () => { bip(1320, 0.15); setTimeout(() => bip(1760, 0.3), 170); },
  };
};

// --- wake lock -------------------------------------------------------------
const criarWakeLock = () => {
  let lock = null;
  const pedir = async () => {
    try {
      lock = navigator.wakeLock ? await navigator.wakeLock.request('screen') : null;
    } catch { lock = null; }
  };
  return {
    pedir,
    // O lock morre quando o app perde o primeiro plano; sem isto a tela apaga
    // na segunda vez que o usuário volta pro app.
    reativar: () => {
      if (document.visibilityState === 'visible' && (!lock || lock.released)) pedir();
    },
    soltar: () => { try { if (lock) lock.release(); } catch {} lock = null; },
  };
};

export const createTreinoPlayer = () => (rotina, aoSair = () => {}) => {
  const linha = construirLinha(rotina);
  if (!linha.length) return;
  const total = duracaoTotal(linha);

  const audio = criarAudio();
  const wake  = criarWakeLock();

  // Relógio. `offset` é o ponto da linha do tempo onde estamos; ao pausar,
  // congelamos o decorrido nele e zeramos a referência. Pular fase também é só
  // mexer no offset — não existe máquina de estados paralela pra dessincronizar.
  let offset = 0;
  let marcoMs = 0;
  let rodando = false;
  let encerrado = false;
  let raf = 0;
  let ultimoIndice = -1;
  let ultimaContagem = -1;

  const decorrido = () => rodando ? offset + (Date.now() - marcoMs) / 1000 : offset;

  const el = document.createElement('div');
  el.id = 'treino-player';
  el.innerHTML = `
    <div class="tp-top">
      <button class="tp-sair" id="tp-sair" type="button" aria-label="Sair do treino">&#10005;</button>
      <div class="tp-serie" id="tp-serie"></div>
      <div class="tp-restante" id="tp-restante"></div>
    </div>

    <div class="tp-palco">
      <div class="tp-tipo"  id="tp-tipo"></div>
      <div class="tp-nome"  id="tp-nome"></div>
      <div class="tp-conta" id="tp-conta">0</div>
      <div class="tp-prox"  id="tp-prox"></div>
    </div>

    <div class="tp-barra"><div class="tp-barra-fill" id="tp-barra"></div></div>

    <div class="tp-controles">
      <button class="tp-btn" id="tp-voltar" type="button" aria-label="Fase anterior">&#9198;</button>
      <button class="tp-btn tp-play" id="tp-play" type="button" aria-label="Iniciar">&#9654;</button>
      <button class="tp-btn" id="tp-pular" type="button" aria-label="Próxima fase">&#9197;</button>
    </div>
  `;
  document.body.appendChild(el);

  const q = (sel) => el.querySelector(sel);
  const elTipo  = q('#tp-tipo');
  const elNome  = q('#tp-nome');
  const elConta = q('#tp-conta');
  const elProx  = q('#tp-prox');
  const elSerie = q('#tp-serie');
  const elRest  = q('#tp-restante');
  const elBarra = q('#tp-barra');
  const elPlay  = q('#tp-play');

  const ROTULO = { prep: 'Preparar', exec: 'Executar', intervalo: 'Intervalo', descanso: 'Descanso' };

  // textContent em vez de innerHTML: o nome do exercício é dado do usuário e
  // nunca vira HTML — não há como injetar marcação por aqui.
  const pintar = () => {
    const t = decorrido();
    const atual = faseEm(linha, t);
    if (!atual) { concluir(); return; }

    const { fase, indice, restante, decorridoNaFase } = atual;

    // Só reescreve os rótulos quando a fase muda — evita mexer no DOM 60x/s.
    if (indice !== ultimoIndice) {
      ultimoIndice = indice;
      ultimaContagem = -1;
      el.dataset.fase = fase.tipo;
      elTipo.textContent = ROTULO[fase.tipo] || '';
      elNome.textContent = fase.tipo === 'exec' ? fase.rotulo : (ROTULO[fase.tipo] || '');
      elProx.textContent = fase.proximo ? `A seguir: ${fase.proximo}` : '';
      elSerie.textContent = `Série ${fase.serie}/${rotina.series}`;
      if (rodando) (fase.tipo === 'exec' ? audio.comecar : audio.parar)();
    }

    elConta.textContent = String(restante);
    elRest.textContent = fmtMMSS(total - t);
    elBarra.style.width = `${Math.min(100, (decorridoNaFase / fase.dur) * 100)}%`;

    // Contagem regressiva sonora nos 3 segundos finais de cada fase.
    if (rodando && restante <= 3 && restante > 0 && restante !== ultimaContagem) {
      ultimaContagem = restante;
      audio.contagem();
    }

    if (rodando) raf = requestAnimationFrame(pintar);
  };

  const tocar = () => {
    if (encerrado) return;
    audio.destravar();          // precisa rodar DENTRO do gesto do usuário (iOS)
    wake.pedir();
    rodando = true;
    marcoMs = Date.now();
    elPlay.innerHTML = '&#10073;&#10073;';
    elPlay.setAttribute('aria-label', 'Pausar');
    el.classList.remove('pausado');
    pintar();
  };

  const pausar = () => {
    offset = decorrido();
    rodando = false;
    cancelAnimationFrame(raf);
    wake.soltar();
    elPlay.innerHTML = '&#9654;';
    elPlay.setAttribute('aria-label', 'Retomar');
    el.classList.add('pausado');
  };

  const irPara = (indice) => {
    offset = inicioDaFase(linha, Math.max(0, Math.min(indice, linha.length)));
    marcoMs = Date.now();
    ultimoIndice = -1;
    if (!rodando) pintar();
  };

  const concluir = () => {
    encerrado = true;
    rodando = false;
    cancelAnimationFrame(raf);
    wake.soltar();
    audio.fim();
    el.dataset.fase = 'fim';
    elTipo.textContent = '';
    elNome.textContent = 'Treino concluído';
    elConta.textContent = '✓';
    elProx.textContent = `${rotina.series} série${rotina.series > 1 ? 's' : ''} · ${fmtMMSS(total)}`;
    elSerie.textContent = '';
    elRest.textContent = '';
    elBarra.style.width = '100%';
    elPlay.innerHTML = '&#9654;';
  };

  const aoVoltarPraTela = () => { if (rodando) wake.reativar(); };
  document.addEventListener('visibilitychange', aoVoltarPraTela);

  // Sair pelo "voltar" do navegador (ou por notificação/deep link) troca a tela
  // por baixo, mas o overlay é fixed e continuaria por cima — com o wake lock
  // ativo e a tela do aparelho nunca apagando, sem o usuário entender por quê.
  // Fechar junto com a rota é mais seguro do que confiar só no botão ✕.
  const aoTrocarRota = () => { if (!location.hash.startsWith('#/treino')) sair(); };
  window.addEventListener('hashchange', aoTrocarRota);

  const sair = () => {
    cancelAnimationFrame(raf);
    wake.soltar();
    document.removeEventListener('visibilitychange', aoVoltarPraTela);
    window.removeEventListener('hashchange', aoTrocarRota);
    el.remove();
    aoSair();
  };

  el.addEventListener('click', (e) => {
    if (e.target.closest('#tp-sair'))  { sair(); return; }
    if (e.target.closest('#tp-play'))  { rodando ? pausar() : tocar(); return; }
    if (e.target.closest('#tp-pular')) { irPara(ultimoIndice + 1); return; }
    if (e.target.closest('#tp-voltar')) {
      // Voltar reinicia a fase atual se ela já passou de 2s — comportamento de
      // player de música, evita pular fase sem querer.
      const atual = faseEm(linha, decorrido());
      const i = atual ? atual.indice : linha.length - 1;
      irPara(atual && atual.decorridoNaFase > 2 ? i : i - 1);
    }
  });

  pintar();   // mostra a primeira fase parada, esperando o play
};
