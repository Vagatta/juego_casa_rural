# LA CASA RURAL · Documento de diseño (Fase 1 y 2)

> "Una casa. Nueve amigos. Demasiados secretos."

## 0. Análisis del concepto y problemas detectados

| Problema del concepto original | Por qué es un problema en una casa rural real | Decisión |
| --- | --- | --- |
| Eliminación estilo Mafia | Un jugador eliminado en el minuto 20 se pasa 70 minutos mirando el móvil. Mata la fiesta. | **Nadie queda eliminado.** Ser sospechoso tiene consecuencias (quedar fuera del Ritual), pero sigues jugando, ganando monedas y haciendo misiones. |
| "Los saboteadores hacen fallar pruebas" | En una prueba física nadie sabe cómo sabotear sin que sea evidente, y el anfitrión no puede arbitrarlo. | Dos capas: sabotaje **físico** (hacerlo mal a propósito, que es divertidísimo de acusar) + sabotaje **digital** limitado: el Ritual de la Vela, con cerillas contadas que dejan rastro (huellas de cera) para las pistas. |
| 5 supervivientes sin nada que hacer | En Mafia los aldeanos se aburren. | Todos los huéspedes tienen un **oficio** con habilidad propia, y todos tienen **misiones secretas**, así que siempre hay algo que hacer. |
| Misiones imposibles de verificar | Si hay que demostrar la misión, se revela. Si no, se hace trampa. | Sistema de honor + **¡PILLADO!** (si crees que alguien tiene una misión sobre ti, le pillas y se la quemas) + **revelación pública de misiones en la ceremonia final**, donde el grupo juzga. La vergüenza social es el árbitro. |
| El anfitrión suele ser uno de los 9 | Si el director ve secretos, arruina su propia partida. | El director **nunca** recibe secretos. El anfitrión juega desde su móvil como uno más y controla la partida desde un panel (o desde una pantalla compartida/TV). Solo si el director NO juega puede abrir el "sobre lacrado", y queda registrado y se anuncia en el final. |
| El anfitrión se va / se le muere el móvil | La partida se bloquea. | El mando del director se puede **reclamar** desde cualquier móvil si el director lleva 60 s desconectado. El enlace de director sirve en cualquier dispositivo. |
| Economía compleja | Nadie la entiende tras tres cervezas. | **Una sola moneda.** "Ganas monedas con pruebas y misiones. Las gastas en la Despensa. Las que te queden al final son tus puntos." |
| Rejugabilidad tras conocer las reglas | Si sabes cómo funciona, se acaba la sorpresa. | Contenido aleatorio (170 misiones, 55 pruebas, 52 eventos, 75 preguntas de quiz, 58 de interrogatorio, 60 sociales, 40 tareas sospechosas, 26 misiones en pareja, 45 parejas de palabras), roles variables según jugadores, plan de rondas generado, pistas generadas con datos reales de la partida (y a veces falsas). |
| Wifi de casa rural | Puede fallar la red. | Reconexión automática con token en `localStorage`, estado autoritativo en servidor, snapshot para sobrevivir reinicios, temporizadores calculados en servidor. |

## 1. Identidad propia

No es Mafia ni Werewolf. El mundo es este:

La casa rural que habéis alquilado tiene una leyenda: **los Cucos**. Como el pájaro que pone sus huevos en nidos ajenos, los Cucos se cuelan entre los huéspedes y quieren que la casa se quede con todos. Cada prueba superada enciende una **vela**. Cada prueba fallada o saboteada abre una **grieta** en la casa.

Al final de la noche se pone todo en **La Balanza**.

## 2. Facciones y roles

### Facciones

| Facción | Objetivo |
| --- | --- |
| 🟢 **Huéspedes** | Encender velas superando pruebas y desenmascarar a los Cucos en la Gran Acusación. |
| 🔴 **Cucos** | Abrir grietas (sabotear) y que no les pillen. Se conocen entre ellos. |
| 🧳 **El Turista** (10+ jugadores) | Va a su bola. Gana si es el más señalado en la Gran Acusación. |

### Roles

| Rol | Facción | Habilidad | Uso |
| --- | --- | --- | --- |
| 🔍 El Curioso | Huésped | **Investigar**: eliges a 2 jugadores y la casa te dice (siempre verdad) si entre ellos hay al menos un Cuco. | 1 por ronda |
| 🧓 La Abuela | Huésped | **Receta secreta**: recibe 3 nombres; uno de ellos es un Cuco seguro. | 1 por partida |
| 🔧 El Manitas | Huésped | **Reparar**: convierte una grieta en vela. Se anuncia a todos (no quién). | 1 por partida |
| 📷 La Fotógrafa | Huésped | **Revelado**: descubre a quién votó un jugador en el último juicio. | 2 por partida |
| 🗣️ El Chismoso | Huésped | **Oído fino** (pasivo): se entera de a quién roban o quién recibe una nota falsa (no de quién lo hace). | Pasivo |
| 🏡 El Vecino | Huésped | **Manos libres** (pasivo): tiene 3 huecos de misión en lugar de 2. | Pasivo |
| 🧮 El Contable | Huésped | **Cliente habitual** (pasivo): la Despensa le sale un 25% más barata. | Pasivo |
| 🌙 El Insomne | Huésped | **Oído de guardia** (pasivo): le llega una nota cada vez que alguien recibe una misión nueva — sabe a quién vigilar para el ¡PILLADO!. | Pasivo |
| � El Notario | Huésped | **Sello notarial**: certifica si una nota bajo la puerta que haya recibido es auténtica o una falsificación (sin saber quién la escribió). Contra del Falsificador. | 1 por partida |
| �🐦 Cuco Falsificador | Cuco | **Falsificar**: deja una nota falsa bajo la puerta de alguien, acusando a quien elija. | 1 por ronda |
| 🧤 Cuco Carterista | Cuco | **Mano larga**: roba 40 monedas a alguien sin pagar. | 1 por ronda |
| 🎭 Cuco Doble | Cuco | **Doble cara** (pasivo): las investigaciones le ven como huésped. | Pasivo |
| 🧳 El Turista | Neutral | Gana si es el más señalado al final. Recibe misiones para parecer sospechoso. | - |

Todos los Cucos tienen **2 cerillas** para apagar velas en el Ritual.

### Reparto por número de jugadores

| Jugadores | Cucos | Curiosos | Turista | Resto |
| --- | --- | --- | --- | --- |
| 6 | 2 | 1 | - | Abuela + 2 oficios al azar |
| 7 | 2 | 1 | - | Abuela + 3 al azar |
| 8 | 2 | 2 | - | Abuela + 3 al azar |
| **9** | **2** | **2** | - | **Abuela + 4 al azar** |
| 10 | 2 | 2 | ✔ | Abuela + 4 al azar |
| 11 | 3 | 2 | ✔ | Abuela + 4 al azar |
| 12 | 3 | 2 | ✔ | Abuela + 5 al azar |

El sorteo de oficios es entre Manitas, Fotógrafa, Chismoso, Contable, Insomne y Notario; el Vecino entra como relleno si faltan plazas. Con 4-5 jugadores (modo mini, no recomendado) hay 1 Cuco. Los Cucos se eligen entre Falsificador, Carterista y Doble (con 3 Cucos salen los tres).

## 3. Economía (se explica en 2 minutos)

**Una moneda: 🪙.** Empiezas con 50. Al final, tus monedas son tus puntos.

| Ganas monedas | 🪙 |
| --- | --- |
| Misión fácil / media / difícil / épica | 40 / 70 / 110 / 180 |
| Prueba de equipo superada (cada participante) | 40 |
| Ganar un duelo / encontrar el código | 60-80 |
| Respuesta correcta en prueba mental | 20 |
| ¡PILLADO! acertado | 50 |
| Final: facción ganadora | +100 |
| Final: primera impresión acertada (ronda 1) | +60 |
| Final: cada Cuco que señalaste bien | +30 |
| Final: Cuco que no fue desenmascarado | +80 |
| Final: Turista más señalado | +250 |

| La Despensa (solo en Investigación) | 🪙 | Efecto |
| --- | --- | --- |
| 🔎 Pista | 40 | Una pista sobre la partida. Normalmente cierta. No siempre. |
| 🔒 Candado | 30 | Te protege del próximo robo. |
| 🗳️ Voto doble | 40 | Tu próximo voto de juicio cuenta doble. |
| 🧤 Ganzúa | 30 | Robas hasta 50 🪙 a alguien (el Candado lo bloquea). |
| 👁️ Mirilla | 50 | Ves a quién votó alguien en el último juicio. |
| 🪪 Coartada | 40 | Bloquea el próximo ¡PILLADO! contra ti (se consume; el acusador paga la multa igual). |
| 📢 Altavoz | 25 | Envías un mensaje anónimo que la casa grita a todos. Sin remitente. |
| 🪞 Espejo | 80 | Te dice la facción real de un jugador (solo facción, no el rol). |
| ✉️ Sobre | libre | Regalas monedas a alguien (sobornos, pactos, deudas). |
| 📜 Nota bajo la puerta | 10 | Mensaje anónimo a un jugador. Idéntico a las notas del Falsificador: nadie sabe si fiarse. |

**Mercado negro**: cada ronda (desde la 2ª), 3 objetos salen un 40% más baratos, anunciado a toda la casa. Corre la estampida a la Despensa.

**Misiones del grupo**: al crear la casa, el anfitrión puede escribir hasta 4 misiones propias (una por línea, máx. 140 caracteres, `{A}`/`{B}` insertan nombres). Se mezclan con el pool normal con peso extra, se reparten en secreto y no se ven en ninguna proyección hasta que caen. Solo viven en esa partida — una casa no contamina a otra.

**Editor de contenido**: en la misma pantalla, el anfitrión puede abrir el catálogo completo y retocarlo solo para su casa — reescribir textos (misiones, instrucciones y títulos de pruebas, eventos, preguntas, quiz, tareas sospechosas, misiones en pareja), quitar piezas que no le gusten y añadir preguntas propias de interrogatorio y de «quién es más probable». Los retoques viajan en `settings.contentMod` (JSON puro, sobrevive snapshots y revancha) y los pools parcheados se resuelven por partida vía `gameContent(g)`; el catálogo global jamás se toca. Las preguntas planas llevan id por índice (`interro:3`, `social:5`) y los títulos usan el sufijo `:title`.

**¡PILLADO!** Una vez por ronda puedes señalar a quien creas que tiene una misión sobre ti. Si aciertas: +50 🪙 y su misión se quema. Si fallas: -20 🪙.

**El Buscavidas 🎩** (rol en el sorteo de oficios): juega como huésped, pero su victoria es personal — solo gana si acaba entre los 3 más ricos contando la pasta antes de los premios (+150 🪙). Desbloquea coaliciones raras.

**La carta del condenado 📜**: quien queda bajo sospecha en un juicio puede escribir una nota anónima (máx. 200 caracteres) que la casa lee en voz alta al abrir la siguiente ronda — o en la ceremonia si no hay más rondas. Se lee sin remite.

**Misión relámpago ⚡** (evento): la casa reparte una misión a cada jugador con 90 segundos de cuenta atrás; la que no se cumple se apaga. En el móvil lleva temporizador; la tele muestra el banner del evento.

**Modo foto 📸**: en el último paso de la ceremonia, un botón abre una pantalla limpia — cartel de la noche, veredicto, ganador y la crónica entera sobre papel — pensada para hacerle una foto y compartirla.

**Doble o nada 🎲** (Despensa, durante la investigación): apuestas monedas (mínimo 10), la moneda cae delante de toda la casa — cara te llevas el doble, cruz lo pierdes. Una jugada por ronda; el resultado sale en la tele al momento.

**Rachas y sequías**: encadena 3 misiones sin que nadie te pille → bonus de +30 🪙 anunciado a toda la casa (y te ponen una diana en la espalda). Que te quemen una misión te rompe la racha. Al revés: si llevas 2 rondas sin ganar una sola moneda, la casa se apiada con +15 🪙 de limosna — también público.

**El sobre del casero 🏷️** (evento): la casa subasta una pista que **siempre dice la verdad**. Pujas selladas desde el móvil (60 segundos, mínimo 10 🪙, puedes rectificar tu puja) — solo se ve cuánta gente ha pujado, nunca cuánto ni quién. Solo paga el ganador; el precio se anuncia en la tele pero el comprador queda en secreto.

## 4. Pistas

Las pistas se generan con **datos reales de la partida**:

- "Entre Ana y Pablo hay al menos un Cuco." / "Ni Ana ni Pablo son Cucos."
- "Uno de los Cucos está entre Laura, Diego y Sergio."
- "Laura no es un Cuco."
- "Huella de cera: alguien del equipo de la prueba 'El nudo humano' usó una cerilla."
- "Marta votó a Carlos en el último juicio."
- "Alguien tiene una misión sobre ti: Sara o Marcos."

Fiabilidad (el jugador **nunca** la ve hasta el final):

| Origen | Cierta | Ambigua | Falsa |
| --- | --- | --- | --- |
| Despensa (normal) | 70% | 15% | 15% |
| Despensa (difícil) | 55% | 20% | 25% |
| Curioso / Abuela / Fotógrafa | 100% | - | - |
| Nota bajo la puerta (evento) | 100% | - | - |
| Nota bajo la puerta (Falsificador) | - | - | 100% |

Las notas de evento y las del Falsificador llegan con **el mismo formato**. Esa es la gracia: "Sé que hay un Cuco, pero no sé si esta nota es fiable." En la ceremonia final se revelan las pistas falsas y quién las escribió.

## 5. Estructura de la partida

| Duración | Rondas | Juicios |
| --- | --- | --- |
| 30 min | 2 | ninguno — solo la Gran Acusación |
| 60 min | 4 | ronda 3 |
| 90 min | 6 | rondas 3 y 5 |
| 120 min | 8 | rondas 3, 5 y 7 |

Cada ronda (≈15 min):

1. **Intro de ronda** (1 min): título, evento aleatorio (si toca), nuevas misiones.
2. **Prueba** (4-8 min): el móvil da instrucciones, temporizador e interacción. La diversión ocurre en el salón.
3. **Ritual de la Vela** (1 min): si la prueba de equipo se superó, cada participante decide en secreto **ENCENDER** o **APAGAR**. Si hay un solo apagón, la vela no se enciende y se abre una grieta. Se sabe cuántos apagones hubo, no quién. Los Huéspedes pueden pulsar APAGAR (para farolear) pero no tiene efecto.
4. **Investigación** (3-4 min): Despensa, habilidades, misiones, ¡PILLADO!, conversaciones.
5. **Juicio** (algunas rondas): voto privado "¿Quién es un Cuco?". El más votado queda **Bajo sospecha**: no participa en el siguiente Ritual y la casa le impone una **tarea sospechosa** forzada la ronda siguiente (no descartable; todos saben que la tiene, no cuál es). No se revela quién votó a quién (salvo evento).
6. **Resumen** de ronda.

**Predicción a ciegas**: durante la ronda 1 (intro y primera prueba, antes de que haya datos), cada jugador sella en secreto a quién huele a Cuco. Una sola elección, inmutable, invisible para todos — ni siquiera el director la ve en las proyecciones. Acertar paga +60 🪙 en la Balanza y se revela en la ceremonia ("Marcos lo olió desde el minuto 1").

**Reacciones a la TV**: durante prueba, investigación, juicios y resultados, cualquier jugador puede lanzar un emoji (😂 😱 🤨 👀 🔪 🤫 👏 💀) que flota ~3 s sobre la pantalla de la casa con su nombre. Cooldown de ~1 s por jugador; whitelist cerrada, nada de texto libre. El Ritual y la revelación de roles no admiten reacciones — esos momentos son sagrados.

La **ronda 1** siempre es de risas (votación social o "Dos verdades y una mentira") para romper el hielo sin afectar a las velas. Las siguientes rotan categorías sin repetir dos físicas seguidas. El modo **Sofá** elimina las pruebas físicas.

### Final

1. **Gran Acusación**: cada jugador señala a tantos jugadores como Cucos haya. Un Cuco queda **desenmascarado** si más de la mitad de la casa lo señala.
   - **La mesa de apuestas**: antes de señalar, cada jugador puede apostar monedas a que alguien es un Cuco (una apuesta por jugador, se cobra al instante). Si acierta, cobra el doble; si falla, lo pierde. Las apuestas son **secretas** hasta la ceremonia — en la mesa solo se ve cuántos han apostado.
2. **La Balanza**:
   - Huéspedes = velas + 2 × Cucos desenmascarados
   - Cucos = grietas + 2 × Cucos ocultos
   - Empate: gana la casa (los Cucos).
3. **Ceremonia**: la noche en cifras → "¿Quién estaba mintiendo?" → cartas de los Cucos → todas las cartas → La Balanza → misiones cumplidas → premios → podio → estadísticas.

## 6. Pruebas (tipos implementados)

| Tipo | Categoría | Cómo funciona | ¿Afecta a velas? |
| --- | --- | --- | --- |
| `physical` | 🏃 Física | El móvil explica y cronometra; el director marca SUPERADA / FALLADA (o elige ganador en duelos). | Sí (equipo) / No (duelo) |
| `quiz` | 🧠 Mental | 3 preguntas en el móvil contra reloj. Superada si el equipo acierta ≥60%. | Sí |
| `code_hunt` | 📱 Móvil | Un jugador recibe un código secreto, lo escribe en un papel y lo esconde. El resto lo busca por la casa y lo introduce en el móvil (5 intentos). | Sí |
| `word_impostor` | 🎭 Mentira | Todos reciben una palabra. Uno (el Infiltrado) recibe otra parecida y no lo sabe. Ronda de pistas en voz alta y votación. | Sí |
| `truth_lie` | 🎭 Mentira | Un jugador cuenta 2 verdades y 1 mentira y marca en secreto la mentira. El resto vota. | No |
| `social_vote` | 😂 Social | "¿Quién es más probable que...?" Premia a quien piensa como la casa. | No |
| `interrogatorio` | 😂 Social | La casa elige a un sospechoso y le lanza 3 preguntas incómodas en voz alta. El director decide si convenció. | Sí (máx. 1 por partida) |

**El saboteador infiltrado**: en pruebas de equipo (35% de las veces, nunca en la ronda 1), un participante recibe una orden secreta de hacer fracasar la prueba (+80🪙 si el equipo falla). Nadie sabe si esta ronda hay uno — solo sale a la luz en la ceremonia.

**Misiones en pareja** (50% de las rondas): dos jugadores reciben la misma tarea y saben quién es su cómplice — coordinarse por miradas sin que nadie lo note. Extra, no gasta hueco.

## 7. Eventos aleatorios

30 eventos en `content/events.json`. Dos familias:
- **Reglas en la habitación** con cuenta atrás (no decir nombres, hablar en susurros, cambiar de sitio...). El director puede multar con monedas.
- **Mecánicos**: monedas dobles, lluvia de monedas, impuesto al rico, Robin Hood, rebajas, despensa cerrada, oleada de misiones, cerillas extra para los Cucos, nota bajo la puerta (pista cierta), juicio a mano alzada.

## 8. Director (qué ve y qué no)

| Ve | No ve |
| --- | --- |
| Jugadores, conexión, monedas, quién ha votado/actuado (no qué) | Roles, misiones, pistas, votos individuales, elecciones del Ritual |
| Fase, temporizador, velas/grietas, evento activo | El código secreto de la prueba del escondite |
| Resultados públicos | La palabra del Infiltrado |

Puede: iniciar, avanzar, pausar/alargar tiempo, arbitrar pruebas, lanzar eventos, ajustar monedas (multas), expulsar, terminar. Si el director **no juega**, puede abrir el **sobre lacrado** (ver roles) para resolver incidencias. Queda registrado y se anuncia en la ceremonia.

**Piloto automático** (`settings.autopilot`, activado por defecto al crear, conmutable en vivo desde el panel): la casa arma sola cuentas atrás cortas en las fases de narración — intro de ronda (14 s), lectura de la prueba (40 s), resultados de prueba/Ritual/juicio (10–16 s), resumen de ronda (18 s) y cada paso de la ceremonia (26 s); la Gran Acusación abre la ceremonia sola al agotarse su timer. La revelación de roles tiene una red de seguridad de 150 s por si alguien no pulsa "listo". El director sigue siendo imprescindible solo donde hace falta criterio humano: arbitrar pruebas físicas e interrogatorios. Apagar el piloto suelta el volante al instante; pausar/alargar funcionan igual sobre los timers del piloto.

## 9. Flujo de usuario (Fase 2 · UX/UI)

### Pantallas del jugador (móvil vertical, desde 320 px)

1. **Inicio**: título, subtítulo, CREAR PARTIDA, UNIRSE A PARTIDA, CÓMO SE JUEGA.
2. **Unirse**: código (5 caracteres, teclado grande), nombre, avatar (12 objetos de la casa). Color asignado.
3. **Sala**: "Bienvenido a la casa." Lista de jugadores con conexión.
4. **Aviso de privacidad** (antes de cualquier secreto): "🔒 INFORMACIÓN PRIVADA · Asegúrate de que nadie está mirando."
5. **Tu identidad**: carta boca abajo → se gira → rol, habilidad, objetivo, compañeros (si eres Cuco). OCULTAR / LO HE ENTENDIDO.
6. **Juego**: barra superior (ronda, monedas, botón OCULTAR que tapa la pantalla al instante) + contenido de fase + barra inferior de pestañas al alcance del pulgar: **Ahora · Misiones · Pistas · Despensa · Cuaderno · Yo**. El Cuaderno es un bloc de notas privado por jugador (guardado en el servidor, solo visible para él: sobrevive a refrescos y al relevo de móvil).
7. **Prueba**: tarjeta de papel con instrucciones, temporizador, interacción según tipo.
8. **Ritual**: dos velas enormes (ENCENDER / APAGAR), tras aviso de privacidad.
9. **Juicio / Gran Acusación**: rejilla de avatares, confirmar.
10. **Ceremonia**: sincronizada con la TV.

### Director / Pantalla de la casa (TV, portátil o tablet)

- Escenario público grande (apto para proyectar): código + QR en la sala, velas y grietas, temporizador enorme, resultados, ceremonia.
- Panel de control lateral (plegable, o "modo TV" sin controles): botón principal contextual (su etiqueta la decide el servidor), temporizador, jugadores, eventos, incidencias.
- **Espectador**: quien llega tarde o no juega puede abrir `/ver/CÓDIGO` (o "solo mirar" en la pantalla de unirse) y ver la misma TV pública sin ser jugador ni necesitar token. Sigue la revancha automáticamente.

### Sistema visual

- Paleta funcional: carbón (fondo), crema y beige (papel), marrón (madera), **verde bosque = información segura**, **rojo oscuro = peligro**, **ámbar = advertencia**, **azul = información especial**.
- Tipografía: *Big Shoulders Stencil* (títulos, sellos, números: evoca cajas de madera y archivadores), *Figtree* (interfaz, muy legible), *Caveat* (notas escritas a mano: misiones y pistas).
- Materiales: papel con grano, cartas físicas con ligera rotación, sellos de lacre para lo privado, polaroids para jugadores, velas con llama animada.
- Animaciones: giro de carta, aparición de cartas, monedas ganadas, transición entre rondas, revelación final. Todas con `transform`/`opacity` y desactivadas con `prefers-reduced-motion`.
- Sonido sintetizado con Web Audio (sin archivos): ambiente, tic de cuenta atrás, misión, peligro, victoria, revelación. Desactivado por defecto; el juego funciona igual sin sonido. Vibración en móviles para avisos privados.
- **Medallero**: la ceremonia reparte medallas (podio, facción ganadora, Cuco en la sombra, apuesta acertada, "Pobre pero honrado"...) que se acumulan en `localStorage` del dispositivo entre noches. Se ven en la Home y en la pestaña "Yo".
- **La crónica de la noche**: último paso de la ceremonia (10º). La casa relata lo que pasó de verdad, ronda a ronda — velas, apagones con nombre (ya no hay secretos), sospechosos, sabotajes, notas bajo las puertas, apuestas — cerrando con la balanza y el más rico. Pensada para leerse en voz alta y hacerle una foto.
