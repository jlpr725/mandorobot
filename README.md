# ROVER CTRL

Control remoto para un carro basado en **micro:bit**, manejable desde una app web (PWA) por **Bluetooth Low Energy**, usando como entrada el **joystick táctil en pantalla**, el **teclado** (para pruebas) o un **mando GameSir X5 Lite** (u otro gamepad estándar) conectado por **USB-C**.

---

## Contenido del proyecto

| Archivo | Descripción |
|---|---|
| `rover-ctrl.html` | La app web completa (frontend + lógica BLE + lectura de joystick/gamepad). Un solo archivo, sin dependencias externas. |
| `microbit-code.js` | Código de referencia en JavaScript para pegar en el editor de **MakeCode**. Recibe los comandos y controla los motores + matriz LED. |
| `README.md` | Este documento. |

---

## Arquitectura general

```
┌─────────────────────┐        BLE (Nordic UART)        ┌──────────────┐
│   rover-ctrl.html    │ ───────────────────────────────▶│   micro:bit   │
│  (Chrome / Android)  │        comandos de 1 char        │  (MakeCode)   │
└─────────┬────────────┘                                  └──────┬───────┘
          │                                                       │
   ┌──────┴───────┐                                        controla
   │ Entradas:     │                                        motores +
   │ • Táctil      │                                        matriz LED
   │ • Teclado     │
   │ • GameSir X5  │
   │   (USB-C)     │
   └───────────────┘
```

- La app se conecta al micro:bit **una sola vez** por Web Bluetooth.
- El GameSir se conecta por **cable USB-C** directamente al celular; Android lo expone como gamepad estándar y el navegador lo lee con la **Gamepad API**. No usa Bluetooth, así que nunca compite con la conexión BLE del micro:bit.
- Sin importar qué entrada esté usando (dedo, teclado o mando), todas terminan generando el mismo tipo de comando corto, que es lo único que le llega al micro:bit.

---

## Protocolo de comandos

Comandos de un solo carácter + salto de línea (`\n`), pensados para compararse fácilmente con bloques `if` en MakeCode:

| Comando | Acción |
|---|---|
| `F` | Avanzar |
| `B` | Retroceder |
| `L` | Girar a la izquierda |
| `R` | Girar a la derecha |
| `S` | Detener motores |
| `C` | Botón AUX 1 (por ahora: ícono de check en la matriz LED) |
| `X` | Botón AUX 2 (por ahora: otro ícono en la matriz LED) |

**Notas de diseño:**
- El comando se envía solo **cuando cambia** la dirección (evento, no continuo), para no saturar la conexión BLE con escrituras innecesarias.
- El joystick funciona como un **D-pad virtual**: no envía velocidad proporcional, solo detecta hacia qué cuadrante se inclina el stick (adelante/atrás/izquierda/derecha) según cuál eje domine, con una zona muerta del 30% para evitar falsos positivos por drift del stick.
- `C` y `X` quedan como *ganchos* para funciones futuras — hoy solo cambian el ícono de la matriz LED, pero puedes reemplazar esa lógica en `microbit-code.js` por lo que necesites (bocina, luces, modo turbo, etc.).

---

## Cómo usar la app

1. Sube tu código a la micro:bit desde MakeCode con el bloque **Bluetooth → Iniciar servicio UART**, o usa `microbit-code.js` como base.
2. En **Project Settings** (ícono de engranaje, "Editar como texto") de MakeCode, agrega `"pairing_mode": 0` para que no pida código de emparejamiento cada vez.
3. Abre `rover-ctrl.html` en **Chrome para Android** (Web Bluetooth no funciona en Safari/iOS).
4. Toca **CONECTAR**, elige tu micro:bit en la lista.
5. Mueve el joystick en pantalla para probar que el carro responda.
6. Conecta el GameSir X5 Lite por USB-C, asegurándote de que esté en **modo Android (HID)**. En cuanto muevas el stick izquierdo, la app lo detecta automáticamente (no hace falta configurar nada) y el indicador inferior cambia a verde con el nombre del mando.

**Mapeo del GameSir:**
- Stick izquierdo → movimiento (igual que el joystick en pantalla).
- Botón **A** → AUX 1 (`C`).
- Botón **B** → AUX 2 (`X`).

---

## Ajustar el cableado de motores

`microbit-code.js` incluye una función por cada dirección (`avanzar()`, `retroceder()`, `girarIzquierda()`, `girarDerecha()`) usando 4 pines digitales de ejemplo (`P0`, `P1`, `P2`, `P8`) para un driver tipo L298N/TB6612 con 2 pines de sentido por motor. Cambia los pines y la lógica de HIGH/LOW según tu cableado real; si tu driver usa PWM para velocidad, reemplaza `pins.digitalWritePin` por `pins.analogWritePin` en esos mismos puntos.

---

## Solución de problemas

**No aparece el micro:bit al tocar "Conectar"**
- Verifica que el servicio UART esté iniciado en el código de la micro:bit (`bluetooth.startUartService()`).
- Solo un dispositivo puede tener una conexión BLE activa con la micro:bit a la vez — cierra cualquier otra app o pestaña conectada.

**Error de GATT / falla la primera conexión (típico en micro:bit v1.5)**
- Es un problema conocido de estabilidad BLE en v1/v1.5 durante el primer `connect()`. Si ocurre, desconecta y vuelve a tocar "Conectar"; normalmente la segunda vez conecta sin problema.
- Si el micro:bit usa muchos bloques de Bluetooth adicionales (varios servicios, notificaciones frecuentes), la RAM limitada (16kb en v1/v1.5) puede saturarse. El v2 (256kb) no tiene esta limitación.

**El GameSir no se detecta**
- Confirma que esté en modo **Android**, no en modo Switch/iOS (revisa el LED o el switch físico del mando).
- Prueba moviendo el stick izquierdo — algunos navegadores solo disparan `gamepadconnected` tras la primera lectura de input, no al simple hecho de conectarlo.

**El carro se mueve solo o no se detiene**
- Revisa la zona muerta (`DEAD_ZONE` en `rover-ctrl.html`) si el stick del GameSir tiene drift; puedes subirla de 0.3 a 0.4.
- Asegúrate de que `detenerMotores()` se llame también en `onBluetoothDisconnected` (ya incluido), para que el carro no quede avanzando si se corta la conexión.

---

## Próximos pasos sugeridos

- Definir las funciones reales de AUX 1 / AUX 2 (bocina, luces, modo turbo, etc.).
- Si se necesita velocidad variable en vez de solo dirección discreta, se puede pasar de comandos de letra a comandos tipo `F80` (dirección + magnitud 0-100), reutilizando la misma cola de escritura BLE.
- Empaquetar `rover-ctrl.html` como PWA instalable (manifest + service worker), igual que el proyecto del sistema de riego.
