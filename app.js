/**
 * NEURO//MATCH — Juego de Memoria | TI3V31
 * Arquitectura:
 *  - Fuente única de verdad: objeto `state`
 *  - La UI se dibuja DESDE el estado, nunca se lee del DOM
 *  - Delegación de eventos: un solo listener en #tablero
 *  - Bloqueo del tablero: state.bloqueado (no trucos con clases)
 *  - Sin innerHTML con datos del usuario (usa textContent / createElement)
 *  - Separación: render(), handlers de eventos, mutaciones de estado
 *  - Sin onclick="" en el HTML
 */

// ── CONSTANTES ────────────────────────────────────────────────────────────────

const EMOJIS = [
  '⬡','⬢','◈','◇','⟁','⊕','⌬','⏣',
  '◉','⊞','⌖','◬','⊗','⊘','⊙','⎔',
  '⌀','⌁'
];

// ── ESTADO (fuente única de verdad) ───────────────────────────────────────────

/** @typedef {{ id: number, emoji: string, volteada: boolean, encontrada: boolean }} Carta */

const state = {
  /** @type {Carta[]} */
  cartas: [],
  /** Índices de las dos cartas actualmente volteadas (max 2) */
  seleccionadas: [],
  /** true mientras se resuelve un par (no se puede voltear más cartas) */
  bloqueado: false,
  movimientos: 0,
  parejasEncontradas: 0,
  totalParejas: 0,
  /** segundos transcurridos */
  segundos: 0,
  timerIntervalId: null,
  juegoActivo: false,
};

// ── AUDIO (Web Audio API — sin archivos externos) ─────────────────────────────
// síntesis pura: drones, pad armónico, arpeggio y ruido filtrado
//
// Dos capas de audio:
//   1. MÚSICA AMBIENTAL ESPACIAL — drones, pad armónico, arpegios lentos y
//      ruido filtrado. Se inicia con el primer clic y se detiene en victoria.
//   2. FANFARRIA DE VICTORIA — secuencia de notas futuristas al ganar.
//
// Todo sintetizado con Web Audio API pura. Sin archivos de audio externos.

const AudioCtx = window.AudioContext || window.webkitAudioContext;
let ctx = null;

/** Devuelve (o crea) el AudioContext compartido */
function getAudioCtx() {
  if (!ctx) ctx = new AudioCtx();
  // Resume si el navegador lo suspendió por política de autoplay
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ── Nodos de música ambiental (guardados para poder detenerlos) ───────────────
const ambientNodes = [];

/**
 * Inicia la música ambiental espacial.
 * Capas:
 *   A) Drone de bajo profundo (sine, 55 Hz + LFO de volumen lento)
 *   B) Pad armónico (tres sines: 110, 165, 220 Hz con detune sutil)
 *   C) Arpeggio muy lento (notas de escala menor pentatónica, cada ~2 s)
 *   D) Ruido "viento espacial" (white noise → BiquadFilter pasa-banda estrecho)
 */
function iniciarAmbiente() {
  if (ambientNodes.length > 0) return; // ya corriendo
  const ac = getAudioCtx();

  // ── Nodo maestro de volumen ambiente ──────────────────────────────────────
  const masterGain = ac.createGain();
  masterGain.gain.setValueAtTime(0.001, ac.currentTime);
  masterGain.gain.linearRampToValueAtTime(0.55, ac.currentTime + 3); // fade-in de 3s
  masterGain.connect(ac.destination);
  ambientNodes.push(masterGain);

  // ── A) Drone de bajo — 55 Hz con LFO de amplitud ─────────────────────────
  const droneOsc = ac.createOscillator();
  const droneGain = ac.createGain();
  droneOsc.type = 'sine';
  droneOsc.frequency.value = 55;

  // LFO de volumen: oscila lentamente entre 0.3 y 1.0 cada ~8 s
  const lfo = ac.createOscillator();
  const lfoGain = ac.createGain();
  lfo.type = 'sine';
  lfo.frequency.value = 0.12; // ciclo cada ~8 s
  lfoGain.gain.value = 0.35;
  lfo.connect(lfoGain);
  lfoGain.connect(droneGain.gain);
  droneGain.gain.value = 0.6;
  lfo.start();

  droneOsc.connect(droneGain);
  droneGain.connect(masterGain);
  droneOsc.start();
  ambientNodes.push(droneOsc, droneGain, lfo, lfoGain);

  // ── B) Pad armónico — tres sines suaves con detune leve ──────────────────
  const padFreqs = [110, 165, 220, 293.3]; // Am pentatónica: A2, E3, A3, D4
  padFreqs.forEach((freq, k) => {
    const osc = ac.createOscillator();
    const g   = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.detune.value = (k % 2 === 0 ? 1 : -1) * (k + 1) * 3; // ±3–12 cents
    g.gain.value = 0.18 / (k + 1); // armónicos más altos, más suaves
    osc.connect(g);
    g.connect(masterGain);
    osc.start();
    ambientNodes.push(osc, g);
  });

  // ── C) Reverb sintético con ConvolverNode ─────────────────────────────────
  // Generamos un impulse response de ruido decreciente como reverb espacioso
  const reverbGain = ac.createGain();
  reverbGain.gain.value = 0.4;
  reverbGain.connect(masterGain);

  const convolver = ac.createConvolver();
  const sampleRate = ac.sampleRate;
  const length = sampleRate * 3; // 3 segundos de cola
  const impulse = ac.createBuffer(2, length, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
    }
  }
  convolver.buffer = impulse;
  convolver.connect(reverbGain);
  ambientNodes.push(convolver, reverbGain);

  // ── D) Arpeggio lento — notas de pentatónica menor, una cada ~2.2 s ──────
  // Escala Am pentatónica en octavas altas para un efecto "cristalino"
  const arpeggioNotas = [220, 261.6, 293.3, 349.2, 392, 440, 523.3, 587.3];
  let arpeggioIdx = 0;
  let arpeggioActivo = true;

  function tocarNota() {
    if (!arpeggioActivo) return;
    const ac2 = getAudioCtx();
    const freq = arpeggioNotas[arpeggioIdx % arpeggioNotas.length];
    arpeggioIdx++;

    const osc = ac2.createOscillator();
    const g   = ac2.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.001, ac2.currentTime);
    g.gain.linearRampToValueAtTime(0.22, ac2.currentTime + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, ac2.currentTime + 1.6);
    osc.connect(g);
    g.connect(convolver);   // con reverb
    g.connect(masterGain);  // y directo
    osc.start();
    osc.stop(ac2.currentTime + 1.8);

    if (arpeggioActivo) {
      // Intervalo variable (1.8–2.8 s) para que suene orgánico
      const delay = 1800 + Math.random() * 1000;
      setTimeout(tocarNota, delay);
    }
  }

  // Guardar función de stop en ambientNodes como objeto especial
  ambientNodes.push({ _stopArpeggio: () => { arpeggioActivo = false; } });
  // Iniciar primer arpeggio con pequeño delay
  setTimeout(tocarNota, 1200);

  // ── E) Ruido "viento espacial" — white noise filtrado ────────────────────
  const bufSize = ac.sampleRate * 2;
  const noiseBuffer = ac.createBuffer(1, bufSize, ac.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufSize; i++) {
    noiseData[i] = Math.random() * 2 - 1;
  }
  const noiseSource = ac.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  noiseSource.loop = true;

  const noiseFilter = ac.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 800;
  noiseFilter.Q.value = 0.4;

  // LFO que mueve la frecuencia del filtro lentamente (efecto "viento")
  const noiseFilterLfo = ac.createOscillator();
  const noiseFilterLfoGain = ac.createGain();
  noiseFilterLfo.type = 'sine';
  noiseFilterLfo.frequency.value = 0.07;
  noiseFilterLfoGain.gain.value = 400;
  noiseFilterLfo.connect(noiseFilterLfoGain);
  noiseFilterLfoGain.connect(noiseFilter.frequency);
  noiseFilterLfo.start();

  const noiseGain = ac.createGain();
  noiseGain.gain.value = 0.04; // muy sutil

  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(masterGain);
  noiseSource.start();

  ambientNodes.push(noiseSource, noiseFilter, noiseFilterLfo, noiseFilterLfoGain, noiseGain);
}

/**
 * Detiene la música ambiental con un fade-out suave.
 */
function detenerAmbiente(fadeDur = 1.5) {
  const ac = getAudioCtx();
  ambientNodes.forEach((node) => {
    if (!node) return;
    // Objeto especial para detener el arpeggio (no es un AudioNode)
    if (node._stopArpeggio) { node._stopArpeggio(); return; }
    if (node instanceof GainNode) {
      try {
        node.gain.cancelScheduledValues(ac.currentTime);
        node.gain.linearRampToValueAtTime(0, ac.currentTime + fadeDur);
      } catch (_) { /* noop */ }
    }
    if (node instanceof AudioScheduledSourceNode || node instanceof AudioBufferSourceNode) {
      try { node.stop(ac.currentTime + fadeDur + 0.1); } catch (_) { /* noop */ }
    }
  });
  ambientNodes.length = 0;
}

/**
 * Fanfarria de victoria — secuencia de notas futuristas.
 */
function tocarVictoria() {
  detenerAmbiente(0.8); // fade-out del ambiente

  const ac = getAudioCtx();
  const secuencia = [
    { f: 523,  t: 0.00, dur: 0.12 },
    { f: 659,  t: 0.12, dur: 0.12 },
    { f: 784,  t: 0.24, dur: 0.12 },
    { f: 1047, t: 0.36, dur: 0.22 },
    { f: 880,  t: 0.58, dur: 0.10 },
    { f: 1047, t: 0.68, dur: 0.10 },
    { f: 1319, t: 0.78, dur: 0.40 },
  ];

  const ahora = ac.currentTime;
  secuencia.forEach(({ f, t, dur }) => {
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f, ahora + t);
    osc.frequency.linearRampToValueAtTime(f * 1.01, ahora + t + dur);
    gain.gain.setValueAtTime(0.001, ahora + t);
    gain.gain.exponentialRampToValueAtTime(0.20, ahora + t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ahora + t + dur);
    osc.start(ahora + t);
    osc.stop(ahora + t + dur + 0.05);

    const osc2  = ac.createOscillator();
    const gain2 = ac.createGain();
    osc2.connect(gain2);
    gain2.connect(ac.destination);
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(f * 1.005, ahora + t);
    gain2.gain.setValueAtTime(0.001, ahora + t);
    gain2.gain.exponentialRampToValueAtTime(0.07, ahora + t + 0.02);
    gain2.gain.exponentialRampToValueAtTime(0.001, ahora + t + dur);
    osc2.start(ahora + t);
    osc2.stop(ahora + t + dur + 0.05);
  });
}

// ── UTILIDADES ────────────────────────────────────────────────────────────────

/** Fisher-Yates shuffle — muta el arreglo y lo retorna */
function barajar(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function formatearTiempo(s) {
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function formatearMovimientos(n) {
  return String(n).padStart(3, '0');
}

// ── MUTACIONES DE ESTADO ──────────────────────────────────────────────────────

function inicializarEstado(numParejas) {
  // Limpiar timer anterior si existe
  if (state.timerIntervalId !== null) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }

  const pool = EMOJIS.slice(0, numParejas);
  const pares = [...pool, ...pool]; // duplicar para formar pares
  barajar(pares);

  state.cartas = pares.map((emoji, id) => ({
    id,
    emoji,
    volteada: false,
    encontrada: false,
  }));
  state.seleccionadas = [];
  state.bloqueado = false;
  state.movimientos = 0;
  state.parejasEncontradas = 0;
  state.totalParejas = numParejas;
  state.segundos = 0;
  state.juegoActivo = false;
}

function iniciarTimer() {
  if (state.timerIntervalId !== null) return; // ya corriendo
  state.timerIntervalId = setInterval(() => {
    if (!state.juegoActivo) return;
    state.segundos++;
    actualizarHUD();
  }, 1000);
}

// ── RENDER (UI desde el estado, NUNCA desde el DOM) ──────────────────────────

const tableroEl        = document.getElementById('tablero');
const contadorEl       = document.getElementById('contador');
const cronometroEl     = document.getElementById('cronometro');
const parejasEl        = document.getElementById('parejas');
const overlayVictoria  = document.getElementById('overlay-victoria');
const vMovimientosEl   = document.getElementById('v-movimientos');
const vTiempoEl        = document.getElementById('v-tiempo');
const vRecordEl        = document.getElementById('v-record');

function actualizarHUD() {
  contadorEl.textContent  = formatearMovimientos(state.movimientos);
  cronometroEl.textContent = formatearTiempo(state.segundos);
  parejasEl.textContent   = `${state.parejasEncontradas}/${state.totalParejas}`;
}

/**
 * Renderiza el tablero completo desde state.cartas.
 * Solo se llama al iniciar/reiniciar; las actualizaciones individuales
 * se hacen con actualizarCarta() para evitar re-crear todo el DOM.
 */
function renderTablero() {
  // Limpiar tablero anterior
  while (tableroEl.firstChild) {
    tableroEl.removeChild(tableroEl.firstChild);
  }

  // Calcular columnas según cantidad de cartas
  const n = state.cartas.length;
  // 12 cartas (6 parejas) → 4 cols × 3 filas
  // 16 cartas (8 parejas) → 4 cols × 4 filas
  // 24 cartas (12 parejas) → 6 cols × 4 filas
  const cols = n <= 16 ? 4 : 6;
  tableroEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

  const frag = document.createDocumentFragment();

  state.cartas.forEach((carta) => {
    const div = document.createElement('div');
    div.className = 'carta';
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');
    div.dataset.indice = carta.id;

    const inner = document.createElement('div');
    inner.className = 'carta-inner';

    const reverso = document.createElement('div');
    reverso.className = 'carta-reverso';

    const frente = document.createElement('div');
    frente.className = 'carta-frente';
    frente.textContent = carta.emoji; // textContent, nunca innerHTML

    inner.appendChild(reverso);
    inner.appendChild(frente);
    div.appendChild(inner);
    frag.appendChild(div);
  });

  tableroEl.appendChild(frag);

  // Aplicar clases visuales desde el estado inicial
  state.cartas.forEach((carta) => {
    if (carta.volteada || carta.encontrada) {
      aplicarClasesCarta(carta);
    }
  });
}

/**
 * Actualiza solo las clases CSS de una carta según su estado.
 * No crea ni destruye elementos DOM — solo modifica clases.
 */
function aplicarClasesCarta(carta) {
  const el = tableroEl.querySelector(`[data-indice="${carta.id}"]`);
  if (!el) return;
  el.classList.toggle('volteada',   carta.volteada && !carta.encontrada);
  el.classList.toggle('encontrada', carta.encontrada);
  el.classList.toggle('error',      false); // limpia por defecto
}

function mostrarError(indices) {
  indices.forEach((i) => {
    const el = tableroEl.querySelector(`[data-indice="${i}"]`);
    if (el) el.classList.add('error');
  });
}

function mostrarVictoria() {
  vMovimientosEl.textContent = state.movimientos;
  vTiempoEl.textContent      = formatearTiempo(state.segundos);

  // Récord en localStorage (bonus)
  const claveRecord = `neuro_record_${state.totalParejas}`;
  const recordPrevio = localStorage.getItem(claveRecord);
  const puntuacion = state.movimientos + state.segundos; // menor = mejor

  if (recordPrevio === null || puntuacion < Number(recordPrevio)) {
    localStorage.setItem(claveRecord, puntuacion);
    vRecordEl.classList.remove('hidden');
  } else {
    vRecordEl.classList.add('hidden');
  }

  overlayVictoria.classList.remove('hidden');
  tocarVictoria();
}

// ── LÓGICA DEL JUEGO ─────────────────────────────────────────────────────────

function voltearCarta(indice) {
  const carta = state.cartas[indice];

  // Guardianes: no voltear si bloqueado, ya encontrada, o ya está entre las seleccionadas
  if (state.bloqueado)          return;
  if (carta.encontrada)         return;
  if (state.seleccionadas.includes(indice)) return;
  if (state.seleccionadas.length >= 2)      return;

  // Primera carta del juego → iniciar timer y música ambiental
  if (!state.juegoActivo) {
    state.juegoActivo = true;
    iniciarTimer();
    iniciarAmbiente();
  }

  // Voltear la carta en el estado
  carta.volteada = true;
  state.seleccionadas.push(indice);
  aplicarClasesCarta(carta);

  actualizarHUD();

  if (state.seleccionadas.length === 2) {
    state.movimientos++;
    actualizarHUD();
    resolverPar();
  }
}

function resolverPar() {
  const [ia, ib] = state.seleccionadas;
  const a = state.cartas[ia];
  const b = state.cartas[ib];

  if (a.emoji === b.emoji) {
    // ¡Pareja encontrada!
    a.encontrada = true;
    b.encontrada = true;
    a.volteada   = false;
    b.volteada   = false;
    state.seleccionadas = [];
    state.parejasEncontradas++;

    aplicarClasesCarta(a);
    aplicarClasesCarta(b);
    actualizarHUD();

    // Comprobar victoria
    if (state.parejasEncontradas === state.totalParejas) {
      state.juegoActivo = false;
      clearInterval(state.timerIntervalId);
      state.timerIntervalId = null;
      // Pequeño delay para que se vea la animación de la carta
      setTimeout(mostrarVictoria, 500);
    }
  } else {
    // No coinciden → bloquear tablero y ocultar tras retardo
    state.bloqueado = true;
    mostrarError([ia, ib]);

    setTimeout(() => {
      a.volteada = false;
      b.volteada = false;
      state.seleccionadas = [];
      state.bloqueado = false;

      aplicarClasesCarta(a);
      aplicarClasesCarta(b);
    }, 900);
  }
}

function reiniciar() {
  const select = document.getElementById('dificultad');
  const numParejas = Number(select.value);

  overlayVictoria.classList.add('hidden');
  detenerAmbiente(0.3); // cortar ambiente rápido al reiniciar
  inicializarEstado(numParejas);
  renderTablero();
  actualizarHUD();
}

// ── DELEGACIÓN DE EVENTOS ─────────────────────────────────────────────────────
// Un solo listener en el contenedor — NO un listener por carta.

tableroEl.addEventListener('click', (e) => {
  const carta = e.target.closest('.carta');
  if (!carta) return;
  const indice = Number(carta.dataset.indice);
  voltearCarta(indice);
});

// Accesibilidad: activar carta con tecla Enter o Espacio
tableroEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const carta = e.target.closest('.carta');
  if (!carta) return;
  e.preventDefault();
  const indice = Number(carta.dataset.indice);
  voltearCarta(indice);
});

// Segundo tipo de evento: keydown global para reiniciar con "R"
document.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') {
    // Solo si el overlay de victoria no está visible, para no interferir
    reiniciar();
  }
});

// Tercer tipo de evento: change en el selector de dificultad
document.getElementById('dificultad').addEventListener('change', () => {
  reiniciar();
});

// Botones de reinicio
document.getElementById('btn-reiniciar').addEventListener('click', reiniciar);
document.getElementById('btn-jugar-de-nuevo').addEventListener('click', reiniciar);

// ── INIT ──────────────────────────────────────────────────────────────────────

reiniciar();
