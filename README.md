# NEURO//MATCH — Juego de Memoria

Proyecto TI3V31 · Programación Front End · Para abrir: doble clic en `index.html`, sin instalación.

---

# ¿Dónde ayudó la IA y dónde se equivocó?

Usé IA para generar la base del HTML, los estilos cyberpunk y la síntesis de audio con Web Audio API. Me ahorró tiempo en las partes más mecánicas.

Pero tuve que corregir tres errores importantes que la IA entregó mal:

  1. La primera versión ponía un `addEventListener` dentro del bucle que crea las cartas, es decir, un listener por cada carta. Eso está mal porque cuando el jugador reinicia y se borra el tablero, esos listeners quedan colgados en memoria. Lo corregí con un solo listener en el contenedor (`#tablero`) usando delegación de eventos.

  2. El bloqueo del tablero lo hacía con una clase CSS (`tablero.classList.add('bloqueado')`). Eso es un truco visual, no lógica real: si el CSS no carga, el bloqueo desaparece. Lo reemplacé por `state.bloqueado = true`, que es estado puro de JavaScript.

  3. En el código de la Parte 2, el mensaje de victoria usaba `innerHTML` para mostrar texto que podría venir del usuario. Eso permite inyectar código malicioso (XSS). Lo corregí usando `textContent`, que siempre trata el contenido como texto plano.

---

## Dos decisiones de diseño

**Delegación de eventos:** en vez de asignar un `addEventListener` a cada carta, puse uno solo en el contenedor del tablero. Cuando el jugador hace clic, pregunto con `e.target.closest('.carta')` sobre qué carta cayó el evento. Esto funciona aunque las cartas se creen o destruyan dinámicamente, y evita fugas de memoria al reiniciar.

**`textContent` en vez de `innerHTML`:** todo el contenido que se escribe en el DOM usa `textContent`, nunca `innerHTML`. La diferencia es que `innerHTML` interpreta el texto como código HTML, lo que abre la puerta a ataques si algún dato viene del usuario. `textContent` lo trata siempre como texto sin más. Es un hábito simple que previene un problema grave.

---

## ¿Qué mejoraría con más tiempo?

Agregaría sonidos individuales para cada carta al voltearla y al encontrar una pareja, no solo al ganar. Ahora la retroalimentación sonora es solo visual durante el juego, y un pequeño clic o tono haría la experiencia mucho más satisfactoria.

---

**Controles:** clic para voltear · tecla `R` para reiniciar · selector de dificultad para cambiar el tamaño del tablero

## Demo en vivo

Juega aquí: https://pedro-inostroza.github.io/Neuro-Match/

Código Auditado y Corregido: https://pedro-inostroza.github.io/Neuro-Match/parte2_corregido.html
