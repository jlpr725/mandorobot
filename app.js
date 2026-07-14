/* ============================================================
   ROVER CTRL
   App de control remoto para carro con micro:bit.
   Entradas soportadas:
     - Joystick táctil en pantalla
     - Teclado (flechas) para pruebas en escritorio
     - Gamepad GameSir X5 Lite (USB-C, modo Android HID) vía Gamepad API
   Salida: comandos cortos por Bluetooth Web (Nordic UART Service)
     F = adelante   B = atrás   L = izquierda   R = derecha   S = detener
     C = AUX 1 (check en la matriz)   X = AUX 2 (otro ícono)
   ============================================================ */

// ---------- Nordic UART Service UUIDs ----------
const UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_RX       = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // escribimos aquí (RX del micro:bit)
const UART_TX       = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // notificaciones del micro:bit (no usado por ahora)

let bleDevice = null, bleServer = null, rxChar = null;
let isConnected = false;

const connectBtn = document.getElementById('connectBtn');
const connectLabel = document.getElementById('connectLabel');
const lastCmdEl = document.getElementById('lastCmd');
const lastSourceEl = document.getElementById('lastSource');
const toastEl = document.getElementById('toast');

function showToast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=> toastEl.classList.remove('show'), 3200);
}

// ---------- Panel de depuración en pantalla ----------
const debugLogEl = document.getElementById('debugLog');
const debugPanelEl = document.getElementById('debugPanel');
document.getElementById('debugHeader').addEventListener('click', ()=>{
  debugPanelEl.classList.toggle('collapsed');
});
function log(msg, type){
  const line = document.createElement('div');
  const time = new Date().toLocaleTimeString('es-CO', {hour12:false});
  line.textContent = `[${time}] ${msg}`;
  if(type) line.classList.add(type);
  debugLogEl.appendChild(line);
  debugLogEl.scrollTop = debugLogEl.scrollHeight;
}
log('App cargada. Toca CONECTAR para escanear.');

async function connectBLE(){
  if(!navigator.bluetooth){
    log('navigator.bluetooth no existe: este navegador no soporta Web Bluetooth. Usa Chrome en Android.', 'err');
    showToast('Este navegador no soporta Web Bluetooth. Usa Chrome en Android.');
    return;
  }
  if(isConnected){
    log('Desconectando manualmente...');
    try{ bleDevice.gatt.disconnect(); }catch(e){}
    return;
  }
  try{
    log('Abriendo selector de dispositivos Bluetooth...');
    bleDevice = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [UART_SERVICE]
    });
    log('Dispositivo elegido: ' + bleDevice.name, 'ok');
    bleDevice.addEventListener('gattserverdisconnected', onDisconnected);

    log('Conectando al servidor GATT...');
    bleServer = await bleDevice.gatt.connect();
    log('GATT conectado.', 'ok');

    log('Buscando servicio UART (' + UART_SERVICE + ')...');
    const service = await bleServer.getPrimaryService(UART_SERVICE);
    log('Servicio UART encontrado.', 'ok');

    log('Buscando característica RX...');
    rxChar = await service.getCharacteristic(UART_RX);
    log('Característica RX lista. Conexión completa.', 'ok');

    isConnected = true;
    connectBtn.classList.add('connected');
    connectLabel.textContent = 'CONECTADO';
  }catch(err){
    console.error(err);
    log('ERROR: ' + (err.message || err), 'err');
    showToast('No se pudo conectar: ' + (err.message || err));
  }
}

function onDisconnected(){
  isConnected = false;
  rxChar = null;
  connectBtn.classList.remove('connected');
  connectLabel.textContent = 'CONECTAR';
  log('micro:bit desconectado.', 'err');
  showToast('micro:bit desconectado');
}

connectBtn.addEventListener('click', connectBLE);

// Cola simple para no saturar la característica BLE con escrituras simultáneas
let writeBusy = false;
const writeQueue = [];
async function sendCommand(cmd, source){
  lastCmdEl.textContent = cmd;
  lastSourceEl.textContent = source;
  if(!isConnected || !rxChar){
    log('Comando "' + cmd + '" generado (' + source + ') pero no hay conexión activa.', 'err');
    return;
  }
  log('Encolando comando: ' + cmd + ' (origen: ' + source + ')');
  writeQueue.push(cmd);
  if(writeBusy) return;
  writeBusy = true;
  while(writeQueue.length){
    const c = writeQueue.shift();
    try{
      const data = new TextEncoder().encode(c + '\n');
      if(rxChar.writeValueWithoutResponse){
        await rxChar.writeValueWithoutResponse(data);
      }else{
        await rxChar.writeValue(data);
      }
      log('Comando enviado: ' + c, 'ok');
    }catch(e){
      console.warn('Fallo de escritura BLE', e);
      log('Fallo al escribir comando "' + c + '": ' + (e.message || e), 'err');
      break;
    }
  }
  writeBusy = false;
}

// ============================================================
// JOYSTICK (táctil + gamepad, unificados)
// ============================================================
const stickWrap = document.getElementById('stickWrap');
const stickKnob = document.getElementById('stickKnob');
const labels = {
  F: document.getElementById('lblF'),
  B: document.getElementById('lblB'),
  L: document.getElementById('lblL'),
  R: document.getElementById('lblR'),
};

const DEAD_ZONE = 0.3;
let currentDir = 'S';       // dirección lógica actual (F/B/L/R/S)
let dragging = false;
let dragSource = 'PANTALLA';

function setKnobPosition(nx, ny){ // nx, ny en rango -1..1
  const wrap = stickWrap.getBoundingClientRect();
  const maxOffset = wrap.width * 0.32;
  const x = nx * maxOffset;
  const y = ny * maxOffset;
  stickKnob.style.transform = `translate(${x}px, ${y}px)`;
}

function highlightLabel(dir){
  Object.values(labels).forEach(l => l.classList.remove('active'));
  if(labels[dir]) labels[dir].classList.add('active');
}

function directionFromVector(nx, ny){
  // nx: -1(izq) .. 1(der)   ny: -1(adelante) .. 1(atrás)
  const mag = Math.hypot(nx, ny);
  if(mag < DEAD_ZONE) return 'S';
  if(Math.abs(ny) >= Math.abs(nx)){
    return ny < 0 ? 'F' : 'B';
  }else{
    return nx < 0 ? 'L' : 'R';
  }
}

function updateStick(nx, ny, source){
  const mag = Math.min(1, Math.hypot(nx, ny));
  const angle = Math.atan2(ny, nx);
  const clampedX = Math.cos(angle) * mag;
  const clampedY = Math.sin(angle) * mag;
  setKnobPosition(clampedX, clampedY);

  const dir = directionFromVector(nx, ny);
  stickWrap.classList.toggle('live', dir !== 'S');
  highlightLabel(dir);

  if(dir !== currentDir){
    currentDir = dir;
    dragSource = source;
    sendCommand(dir, source);
  }
}

function resetStick(source){
  setKnobPosition(0,0);
  stickWrap.classList.remove('live','active');
  highlightLabel(null);
  if(currentDir !== 'S'){
    currentDir = 'S';
    sendCommand('S', source);
  }
}

// --- Entrada táctil / mouse ---
function pointerPos(evt){
  const wrap = stickWrap.getBoundingClientRect();
  const cx = wrap.left + wrap.width/2;
  const cy = wrap.top + wrap.height/2;
  const px = (evt.touches ? evt.touches[0].clientX : evt.clientX);
  const py = (evt.touches ? evt.touches[0].clientY : evt.clientY);
  const radius = wrap.width/2;
  let nx = (px - cx) / radius;
  let ny = (py - cy) / radius;
  return {nx, ny};
}

function onPointerDown(evt){
  dragging = true;
  stickWrap.classList.add('active');
  const {nx, ny} = pointerPos(evt);
  updateStick(nx, ny, 'PANTALLA');
  evt.preventDefault();
}
function onPointerMove(evt){
  if(!dragging) return;
  const {nx, ny} = pointerPos(evt);
  updateStick(nx, ny, 'PANTALLA');
  evt.preventDefault();
}
function onPointerUp(evt){
  if(!dragging) return;
  dragging = false;
  resetStick('PANTALLA');
}

stickWrap.addEventListener('mousedown', onPointerDown);
window.addEventListener('mousemove', onPointerMove);
window.addEventListener('mouseup', onPointerUp);
stickWrap.addEventListener('touchstart', onPointerDown, {passive:false});
window.addEventListener('touchmove', onPointerMove, {passive:false});
window.addEventListener('touchend', onPointerUp);

// --- Entrada de teclado (pruebas en escritorio) ---
const keyState = {ArrowUp:false, ArrowDown:false, ArrowLeft:false, ArrowRight:false};
function keyboardToVector(){
  let nx = 0, ny = 0;
  if(keyState.ArrowUp) ny -= 1;
  if(keyState.ArrowDown) ny += 1;
  if(keyState.ArrowLeft) nx -= 1;
  if(keyState.ArrowRight) nx += 1;
  return {nx, ny};
}
window.addEventListener('keydown', (e)=>{
  if(!(e.key in keyState)) return;
  if(keyState[e.key]) return;
  keyState[e.key] = true;
  if(!padActive){
    const {nx, ny} = keyboardToVector();
    stickWrap.classList.add('active');
    updateStick(nx, ny, 'TECLADO');
  }
});
window.addEventListener('keyup', (e)=>{
  if(!(e.key in keyState)) return;
  keyState[e.key] = false;
  if(!padActive){
    const {nx, ny} = keyboardToVector();
    if(nx === 0 && ny === 0) resetStick('TECLADO');
    else updateStick(nx, ny, 'TECLADO');
  }
});

// ============================================================
// GAMEPAD (GameSir X5 Lite u otro mando estándar por USB-C)
// ============================================================
const padStatusEl = document.getElementById('padStatus');
const padLabelEl = document.getElementById('padLabel');
let padActive = false;
let padPrevButtons = [false, false];

window.addEventListener('gamepadconnected', (e)=>{
  padActive = true;
  padStatusEl.classList.add('on');
  padLabelEl.textContent = 'MANDO: ' + e.gamepad.id.slice(0,26);
  showToast('Mando conectado');
});
window.addEventListener('gamepaddisconnected', ()=>{
  padActive = false;
  padStatusEl.classList.remove('on');
  padLabelEl.textContent = 'SIN MANDO USB-C';
  resetStick('MANDO');
});

function pollGamepad(){
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = pads && pads[0];
  if(gp){
    if(!padActive){
      padActive = true;
      padStatusEl.classList.add('on');
      padLabelEl.textContent = 'MANDO: ' + gp.id.slice(0,26);
    }
    const nx = gp.axes[0] || 0;
    const ny = gp.axes[1] || 0;
    stickWrap.classList.toggle('active', Math.hypot(nx,ny) > 0.05);
    if(Math.hypot(nx, ny) < 0.05){
      resetStick('MANDO');
    }else{
      updateStick(nx, ny, 'MANDO');
    }

    // Botones A (0) y B (1) -> AUX1 / AUX2, disparo por flanco de subida
    const btnA = !!(gp.buttons[0] && gp.buttons[0].pressed);
    const btnB = !!(gp.buttons[1] && gp.buttons[1].pressed);
    if(btnA && !padPrevButtons[0]) triggerAux(1);
    if(btnB && !padPrevButtons[1]) triggerAux(2);
    padPrevButtons = [btnA, btnB];
  }
  requestAnimationFrame(pollGamepad);
}
requestAnimationFrame(pollGamepad);

// ============================================================
// BOTONES AUX (futuras funciones — por ahora: iconos en la matriz LED)
// ============================================================
function triggerAux(n){
  const el = document.getElementById('aux' + n);
  el.style.borderColor = 'var(--accent)';
  setTimeout(()=> el.style.borderColor = '', 180);
  sendCommand(n === 1 ? 'C' : 'X', padActive ? 'MANDO' : 'PANTALLA');
}
document.getElementById('aux1').addEventListener('click', ()=> triggerAux(1));
document.getElementById('aux2').addEventListener('click', ()=> triggerAux(2));
