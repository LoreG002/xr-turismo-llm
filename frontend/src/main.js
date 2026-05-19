import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// =====================================================
// SETUP SCENA
// =====================================================
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
camera.position.set(0, 0, 0.1);
controls.update();

// Sfera panoramica
const geometry = new THREE.SphereGeometry(500, 60, 40);
geometry.scale(-1, 1, 1);
const material = new THREE.MeshBasicMaterial();
const sphere = new THREE.Mesh(geometry, material);
scene.add(sphere);

// =====================================================
// LUCI
// =====================================================
// Servono per i GLB: senza luci i materiali PBR vengono neri
const ambientLight = new THREE.AmbientLight(0xffffff, 1.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.3);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);

// Fill light dal lato opposto, altrimenti certe facce restano grigie
const dirLightFill = new THREE.DirectionalLight(0xffffff, 0.9);
dirLightFill.position.set(-6, -3, -8);
scene.add(dirLightFill);

// Gruppi
const hotspotGroup = new THREE.Group();
scene.add(hotspotGroup);

// =====================================================
// OVERLAY FADE per cambio scena
// =====================================================
const overlay = document.createElement('div');
overlay.style.cssText = `
  position: fixed; top: 0; left: 0;
  width: 100%; height: 100%;
  background: black; opacity: 0;
  transition: opacity 0.5s;
  pointer-events: none;
  z-index: 999;
`;
document.body.appendChild(overlay);

// Altezza dei modelli in metri (il GLB viene normalizzato a questo valore)
const HOTSPOT_ALTEZZA_INFO = 0.8;
const HOTSPOT_ALTEZZA_NAV = 1.05;
const HOTSPOT_ANELLO_INNER = 0.5;
const HOTSPOT_ANELLO_OUTER = 0.65;
let scenaCorrente = null;
let tourData = null;

// Modelli GLB, caricati una volta sola
const modelli = {
  infoSign: null,
  mapPointer: null,
};

// =====================================================
// PANNELLO GUIDA AI — 3D, FISSO NELLO SPAZIO
// =====================================================
const PANNELLO_W = 5.2;          // larghezza piano (m)
const PANNELLO_OFFSET_LAT = 4.6; // scostamento laterale dall'hotspot
const PANNELLO_RAGGIO = 9;       // distanza dal centro scena

const CANVAS_W = 1024;

// Schede di approfondimento (le tab sotto il pannello)
const SCHEDA_GAP = 0.04;
const SCHEDA_H = 0.82;
const SCHEDA_SPORGENZA = 0.62;
const SCHEDA_SOVRAPP = 0.06;

const pannello3D = {
  group: null,
  pianoMesh: null,
  canvas: null,
  ctx: null,
  texture: null,
  chiudiMesh: null,
  bottoniGroup: null,
  altezzaPiano: 0,
};

function creaPannello3D() {
  const group = new THREE.Group();

  // Canvas + texture
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  // Piano
  const pianoGeo = new THREE.PlaneGeometry(PANNELLO_W, PANNELLO_W);
  const pianoMat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const pianoMesh = new THREE.Mesh(pianoGeo, pianoMat);
  pianoMesh.renderOrder = 10;
  group.add(pianoMesh);

  // Bottone chiudi
  const chiudiGeo = new THREE.SphereGeometry(0.18, 20, 20);
  const chiudiMat = new THREE.MeshBasicMaterial({
    color: 0xff5a7a,
    depthTest: false,
  });
  const chiudiMesh = new THREE.Mesh(chiudiGeo, chiudiMat);
  chiudiMesh.renderOrder = 11;
  chiudiMesh.userData = { tipo: 'chiudi_pannello' };

  // X disegnata sul bottone chiudi
  const xCanvas = document.createElement('canvas');
  xCanvas.width = 128; xCanvas.height = 128;
  const xCtx = xCanvas.getContext('2d');
  xCtx.strokeStyle = 'white';
  xCtx.lineWidth = 14;
  xCtx.lineCap = 'round';
  xCtx.beginPath();
  xCtx.moveTo(40, 40); xCtx.lineTo(88, 88);
  xCtx.moveTo(88, 40); xCtx.lineTo(40, 88);
  xCtx.stroke();
  const xTex = new THREE.CanvasTexture(xCanvas);
  const xMat = new THREE.SpriteMaterial({ map: xTex, transparent: true, depthTest: false });
  const xSprite = new THREE.Sprite(xMat);
  xSprite.scale.set(0.3, 0.3, 1);
  xSprite.renderOrder = 12;
  chiudiMesh.add(xSprite);
  group.add(chiudiMesh);

  // Sotto-gruppo per le schede
  const bottoniGroup = new THREE.Group();
  group.add(bottoniGroup);

  group.visible = false;
  scene.add(group);

  pannello3D.group = group;
  pannello3D.pianoMesh = pianoMesh;
  pannello3D.canvas = canvas;
  pannello3D.ctx = ctx;
  pannello3D.texture = texture;
  pannello3D.chiudiMesh = chiudiMesh;
  pannello3D.bottoniGroup = bottoniGroup;
}

// Word-wrap su canvas
function spezzaTesto(ctx, testo, larghezzaMax) {
  const parole = testo.split(/\s+/);
  const righe = [];
  let rigaCorrente = '';

  for (const parola of parole) {
    const prova = rigaCorrente ? rigaCorrente + ' ' + parola : parola;
    if (ctx.measureText(prova).width > larghezzaMax && rigaCorrente) {
      righe.push(rigaCorrente);
      rigaCorrente = parola;
    } else {
      rigaCorrente = prova;
    }
  }
  if (rigaCorrente) righe.push(rigaCorrente);
  return righe;
}

// roundRect non c'è su tutti i browser
function rettArrotondato(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Ridisegna il pannello con titolo + testo
function disegnaPannello(titolo, testo) {
  const { canvas, ctx, pianoMesh, chiudiMesh } = pannello3D;

  // Placeholder se il backend torna vuoto
  titolo = (titolo ?? '').toString().trim() || 'Guida AI';
  testo = (testo ?? '').toString().trim() || 'Nessun contenuto disponibile.';

  const PAD = 60;
  const FONT_TITOLO = 52;
  const FONT_TESTO = 34;
  const INTERLINEA_TITOLO = 64;
  const INTERLINEA_TESTO = 48;
  const larghezzaTesto = CANVAS_W - PAD * 2;

  ctx.font = `bold ${FONT_TITOLO}px sans-serif`;
  const righeTitolo = spezzaTesto(ctx, titolo, larghezzaTesto);

  ctx.font = `${FONT_TESTO}px sans-serif`;
  const righeTesto = spezzaTesto(ctx, testo, larghezzaTesto);

  // Altezza canvas in base alle righe
  const altezzaTitolo = righeTitolo.length * INTERLINEA_TITOLO;
  const altezzaTesto = righeTesto.length * INTERLINEA_TESTO;
  const SPAZIO_TITOLO_TESTO = 28;
  const altezzaContenuto = altezzaTitolo + SPAZIO_TITOLO_TESTO + altezzaTesto;
  canvas.height = PAD * 2 + altezzaContenuto;

  // Sfondo
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, 'rgba(40, 20, 70, 0.92)');
  grad.addColorStop(1, 'rgba(20, 15, 40, 0.95)');
  ctx.fillStyle = grad;
  rettArrotondato(ctx, 0, 0, canvas.width, canvas.height, 40);
  ctx.fill();

  ctx.strokeStyle = 'rgba(192, 132, 252, 0.45)';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Titolo
  ctx.fillStyle = '#d8b4fe';
  ctx.font = `bold ${FONT_TITOLO}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let y = PAD;
  for (const riga of righeTitolo) {
    ctx.fillText(riga, PAD, y);
    y += INTERLINEA_TITOLO;
  }

  // Corpo
  y += SPAZIO_TITOLO_TESTO;
  ctx.fillStyle = 'rgba(243, 244, 246, 0.95)';
  ctx.font = `${FONT_TESTO}px sans-serif`;
  for (const riga of righeTesto) {
    ctx.fillText(riga, PAD, y);
    y += INTERLINEA_TESTO;
  }

  // Ricreo la texture: dopo un resize del canvas needsUpdate da solo non basta
  if (pannello3D.texture) pannello3D.texture.dispose();
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  pannello3D.texture = texture;
  pianoMesh.material.map = texture;
  pianoMesh.material.needsUpdate = true;

  // Aggiorno le proporzioni del piano
  const ratio = canvas.height / canvas.width;
  const altezzaPiano = PANNELLO_W * ratio;
  pannello3D.altezzaPiano = altezzaPiano;
  pianoMesh.geometry.dispose();
  pianoMesh.geometry = new THREE.PlaneGeometry(PANNELLO_W, altezzaPiano);

  // Bottone chiudi in alto a destra
  chiudiMesh.position.set(
    PANNELLO_W / 2 - 0.05,
    altezzaPiano / 2 - 0.05,
    0.05
  );

  riposizionaBottoni();
}

// Dispone le schede in riga sotto il pannello
function riposizionaBottoni() {
  const schede = pannello3D.bottoniGroup.children;
  const totale = schede.length;
  if (totale === 0) return;

  const larghezzaScheda = (PANNELLO_W - SCHEDA_GAP * (totale - 1)) / totale;
  const bordoInferiore = -pannello3D.altezzaPiano / 2;
  const centroY = bordoInferiore + SCHEDA_SOVRAPP - SCHEDA_H / 2;

  schede.forEach((mesh, i) => {
    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(larghezzaScheda, SCHEDA_H);

    const x = -PANNELLO_W / 2 + larghezzaScheda / 2
      + i * (larghezzaScheda + SCHEDA_GAP);
    mesh.userData.targetY = centroY;
    mesh.position.set(x, centroY, 0.02);

    disegnaScheda(mesh);
  });
}

// Disegna la texture di una scheda (cambia se selezionata)
function disegnaScheda(mesh) {
  const { label, selezionata } = mesh.userData;
  const canvas = mesh.userData.canvas;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const R = 36;

  ctx.clearRect(0, 0, W, H);

  // Sfondo
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  if (selezionata) {
    grad.addColorStop(0, 'rgba(170, 90, 255, 0.95)');
    grad.addColorStop(1, 'rgba(120, 60, 200, 0.95)');
  } else {
    grad.addColorStop(0, 'rgba(60, 35, 100, 0.88)');
    grad.addColorStop(1, 'rgba(35, 22, 65, 0.92)');
  }
  ctx.fillStyle = grad;

  // Angoli arrotondati solo sotto: sembra esca dal pannello
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, H - R);
  ctx.arcTo(W, H, W - R, H, R);
  ctx.lineTo(R, H);
  ctx.arcTo(0, H, 0, H - R, R);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = selezionata
    ? 'rgba(230, 200, 255, 0.9)'
    : 'rgba(192, 132, 252, 0.4)';
  ctx.lineWidth = selezionata ? 5 : 3;
  ctx.stroke();

  // Label
  ctx.fillStyle = selezionata ? '#ffffff' : 'rgba(243, 244, 246, 0.92)';
  ctx.font = 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const righe = spezzaTesto(ctx, label, W - 60);
  const interlinea = 64;
  let y = H / 2 - (righe.length - 1) * interlinea / 2;
  for (const riga of righe) {
    ctx.fillText(riga, W / 2, y);
    y += interlinea;
  }

  mesh.userData.texture.needsUpdate = true;
}

// =====================================================
// SCHEDE APPROFONDIMENTO (tab integrate nel pannello)
// =====================================================
function creaBottoneApprofondimento(label, query) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  // Le dimensioni reali del piano le imposta riposizionaBottoni
  const geo = new THREE.PlaneGeometry(1, SCHEDA_H);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 11;
  mesh.userData = {
    tipo: 'approfondimento',
    label,
    query,
    canvas,
    texture,
    selezionata: false,
  };

  pannello3D.bottoniGroup.add(mesh);

  // Slide-in: la scheda scivola fuori verso il basso
  let progresso = 0;
  const slideOut = setInterval(() => {
    progresso += 0.08;
    if (progresso >= 1) { progresso = 1; clearInterval(slideOut); }
    mat.opacity = progresso;
    mesh.position.y = mesh.userData.targetY != null
      ? mesh.userData.targetY + (1 - progresso) * 0.25
      : mesh.position.y;
  }, 25);

  return mesh;
}

// Evidenzia la scheda cliccata, attenua le altre
function selezionaScheda(meshSelezionata) {
  pannello3D.bottoniGroup.children.forEach(mesh => {
    mesh.userData.selezionata = (mesh === meshSelezionata);
    disegnaScheda(mesh);
  });
}

function clearApprofondimenti() {
  pannello3D.bottoniGroup.children.forEach(mesh => {
    mesh.geometry?.dispose();
    mesh.material?.map?.dispose();
    mesh.material?.dispose();
  });
  pannello3D.bottoniGroup.clear();
}

// Mette il pannello a sinistra dell'hotspot, così non copre il monumento
function posizionaPannelloAccantoA(posizioneHotspot) {
  const group = pannello3D.group;

  const lato = -1; // sinistra

  // Direzione verso l'hotspot sul piano XZ
  const dir = new THREE.Vector3(posizioneHotspot.x, 0, posizioneHotspot.z);
  if (dir.lengthSq() < 0.0001) dir.set(0, 0, -1);
  dir.normalize();

  // Perpendicolare a dir
  const destra = new THREE.Vector3(-dir.z, 0, dir.x);

  const pos = dir.clone().multiplyScalar(PANNELLO_RAGGIO)
    .add(destra.multiplyScalar(lato * PANNELLO_OFFSET_LAT));

  pos.y = posizioneHotspot.y - 0.5;

  group.position.copy(pos);
}

function mostraPannello() {
  pannello3D.group.visible = true;
}

function nascondiPannello() {
  pannello3D.group.visible = false;
  clearApprofondimenti(); // schede e pannello vanno insieme
}

// =====================================================
// INIZIALIZZAZIONE
// =====================================================
// Rimpiazza i materiali del GLB (i colori originali a volte vengono da texture)
function ricoloraModello(modello, { colore, emissivo, emissiveIntensity, opacita }) {
  modello.traverse((nodo) => {
    if (!nodo.isMesh) return;
    nodo.material = new THREE.MeshStandardMaterial({
      color: colore,
      emissive: emissivo,
      emissiveIntensity: emissiveIntensity,
      roughness: 0.35,
      metalness: 0.1,
      transparent: opacita < 1,
      opacity: opacita,
    });
  });
}

async function caricaModelliGLB() {
  const loader = new GLTFLoader();
  try {
    const infoRes = await loader.loadAsync('/models/highpoly_info_sign_3d_icon.glb');
    modelli.infoSign = infoRes.scene;
    // Info → giallo acceso
    ricoloraModello(modelli.infoSign, {
      colore: 0xffcc33,
      emissivo: 0xffaa00,
      emissiveIntensity: 0.9,
      opacita: 0.82,
    });

    const navRes = await loader.loadAsync('/models/map_pointer_3d_icon.glb');
    modelli.mapPointer = navRes.scene;
    // Pointer → azzurro
    ricoloraModello(modelli.mapPointer, {
      colore: 0x33aaff,
      emissivo: 0x0077cc,
      emissiveIntensity: 0.4,
      opacita: 0.82,
    });
  } catch (err) {
    console.error('Errore caricamento modelli GLB:', err);
  }
}

async function inizializza() {
  creaPannello3D();
  await caricaModelliGLB();
  const res = await fetch('/tour.json');
  tourData = await res.json();
  caricaScena('scena1');
}

// Label "pill" dell'hotspot
function disegnaLabelHotspot(testo, isInfo) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const R = 80;

  // Sfondo
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, 'rgba(40, 20, 70, 0.82)');
  grad.addColorStop(1, 'rgba(20, 15, 40, 0.88)');
  ctx.fillStyle = grad;
  rettArrotondato(ctx, 8, 8, W - 16, H - 16, R);
  ctx.fill();

  ctx.strokeStyle = isInfo
    ? 'rgba(255, 200, 120, 0.55)'
    : 'rgba(130, 200, 255, 0.55)';
  ctx.lineWidth = 5;
  ctx.stroke();

  // Pallino-accento a sinistra
  const accento = isInfo ? '#ffb84d' : '#5ec6ff';
  ctx.fillStyle = accento;
  ctx.beginPath();
  ctx.arc(110, H / 2, 26, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f3f4f6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const margineSx = 170; // spazio per il pallino
  const margineDx = 70;
  const larghezzaTesto = W - margineSx - margineDx;
  const centroX = margineSx + larghezzaTesto / 2;

  // Se servono più di 2 righe, rimpicciolisco il font una volta
  let fontSize = 76;
  ctx.font = `bold ${fontSize}px sans-serif`;
  let righe = spezzaTesto(ctx, testo, larghezzaTesto);

  if (righe.length > 2) {
    fontSize = 60;
    ctx.font = `bold ${fontSize}px sans-serif`;
    righe = spezzaTesto(ctx, testo, larghezzaTesto);
  }

  const interlinea = fontSize + 12;
  let y = H / 2 - (righe.length - 1) * interlinea / 2;
  for (const riga of righe) {
    ctx.fillText(riga, centroX, y);
    y += interlinea;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

// =====================================================
// HOTSPOT (info + navigazione)
// =====================================================
function creaHotspot(dati) {
  const isInfo = dati.tipo === 'info';
  const modello = isInfo ? modelli.infoSign : modelli.mapPointer;
  const altezzaTarget = isInfo ? HOTSPOT_ALTEZZA_INFO : HOTSPOT_ALTEZZA_NAV;

  let group = new THREE.Group();
  let modelloClone = null;
  if (modello) {
    const clone = modello.clone();

    // Normalizzo la scala all'altezza voluta
    const bbox = new THREE.Box3().setFromObject(clone);
    const dimensioni = new THREE.Vector3();
    bbox.getSize(dimensioni);
    const altezzaAttuale = dimensioni.y || 1;
    const fattore = altezzaTarget / altezzaAttuale;
    clone.scale.setScalar(fattore);

    // Ricentro sul pivot del gruppo
    const bboxScalato = new THREE.Box3().setFromObject(clone);
    const centro = new THREE.Vector3();
    bboxScalato.getCenter(centro);
    clone.position.sub(centro);
    clone.userData.posBase = clone.position.clone(); // base per il galleggiamento

    group.add(clone);
    modelloClone = clone;
  } else {
    // Fallback se il GLB non carica
    const geo = new THREE.SphereGeometry(0.4, 16, 16);
    const colore = isInfo ? 0xffaa00 : 0x00aaff;
    const mat = new THREE.MeshBasicMaterial({ color: colore });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.posBase = mesh.position.clone();
    group.add(mesh);
    modelloClone = mesh;
  }

  group.position.set(dati.posizione.x, dati.posizione.y, dati.posizione.z);
  group.userData = {
    ...dati,
    isInfo,
    modello: modelloClone,
    centroY: dati.posizione.y,
    faseAnim: Math.random() * Math.PI * 2, // sfasamento del galleggiamento
  };

  // Anello attorno all'hotspot
  const anelloGeo = new THREE.RingGeometry(HOTSPOT_ANELLO_INNER, HOTSPOT_ANELLO_OUTER, 32);
  const anelloMat = new THREE.MeshBasicMaterial({
    color: isInfo ? 0xffaa00 : 0x00aaff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.6,
    depthTest: false,
  });
  const anello = new THREE.Mesh(anelloGeo, anelloMat);
  anello.renderOrder = 9;
  anello.userData.isAnello = true;
  group.add(anello);

  // Label
  const tex = disegnaLabelHotspot(dati.label, isInfo);
  const labelMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const labelSprite = new THREE.Sprite(labelMat);
  labelSprite.scale.set(4, 1, 1);
  labelSprite.position.set(0, 1.2, 0);

  group.add(labelSprite);
  hotspotGroup.add(group);
}

// =====================================================
// CARICAMENTO SCENA
// =====================================================
const textureLoader = new THREE.TextureLoader();

function caricaScena(idScena) {
  const scena = tourData.scene[idScena];
  scenaCorrente = scena;
  overlay.style.opacity = 1;

  setTimeout(() => {
    textureLoader.load(scena.panorama, (texture) => {
      material.map = texture;
      material.needsUpdate = true;
      hotspotGroup.clear();
      nascondiPannello();
      scena.hotspot.forEach(h => creaHotspot(h));
      overlay.style.opacity = 0;
    });
  }, 500);
}

// =====================================================
// CHIAMATE AL BACKEND
// =====================================================
async function fetchDescrizione(luogo_id) {
  try {
    const res = await fetch(`http://localhost:8000/spiegazione/${encodeURIComponent(luogo_id)}`);
    return await res.json();
  } catch {
    return { descrizione: "Errore di connessione con il backend.", approfondimenti: [] };
  }
}

async function fetchApprofondimento(argomento) {
  try {
    const res = await fetch(`http://localhost:8000/approfondimento/${encodeURIComponent(argomento)}`);
    return await res.json();
  } catch {
    return { descrizione: "Errore di connessione." };
  }
}

// =====================================================
// RAYCASTING + INTERAZIONE
// =====================================================
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

window.addEventListener('click', async (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  // Hotspot + (se il pannello è aperto) chiudi e schede
  const oggettiCliccabili = [...hotspotGroup.children];
  if (pannello3D.group.visible) {
    oggettiCliccabili.push(pannello3D.chiudiMesh);
    oggettiCliccabili.push(...pannello3D.bottoniGroup.children);
  }
  const hits = raycaster.intersectObjects(oggettiCliccabili, true);

  if (hits.length === 0) return;

  // Risalgo fino al mesh con userData utile
  let obj = hits[0].object;
  while (obj.parent && !obj.userData.tipo && !obj.userData.id) {
    obj = obj.parent;
  }
  const dati = obj.userData;

  // Chiudi pannello
  if (dati.tipo === 'chiudi_pannello') {
    nascondiPannello();
    return;
  }

  // Cambio scena
  if (dati.tipo === 'nav' || dati.destinazione) {
    caricaScena(dati.destinazione);
    return;
  }

  // Hotspot info → descrizione + schede
  if (dati.tipo === 'info') {
    clearApprofondimenti();
    posizionaPannelloAccantoA(obj.position);
    disegnaPannello(dati.label, "Sto interpellando la guida storica...");
    mostraPannello();

    const risposta = await fetchDescrizione(dati.query);

    // Creo le schede prima di disegnare, così riposizionaBottoni le trova
    if (risposta.approfondimenti?.length > 0) {
      risposta.approfondimenti.forEach((app) => {
        creaBottoneApprofondimento(app.label, app.query);
      });
    }
    disegnaPannello(dati.label, risposta.descrizione);
    return;
  }

  // Click su una scheda → solo descrizione
  if (dati.tipo === 'approfondimento') {
    selezionaScheda(obj);

    disegnaPannello(dati.label, "Approfondimento in corso...");
    // disegnaPannello ridisegna le schede, quindi riapplico la selezione
    selezionaScheda(obj);

    const risposta = await fetchApprofondimento(dati.query);
    disegnaPannello(dati.label, risposta.descrizione);
    selezionaScheda(obj);
    return;
  }
});

// =====================================================
// RESIZE
// =====================================================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// =====================================================
// ANIMATION LOOP
// =====================================================
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  controls.update();

  const t = clock.getElapsedTime();

  // Pannello sempre frontale all'utente
  if (pannello3D.group && pannello3D.group.visible) {
    pannello3D.group.lookAt(
      camera.position.x,
      pannello3D.group.position.y,
      camera.position.z
    );
  }

  // Animazioni hotspot
  hotspotGroup.children.forEach(group => {
    const ud = group.userData;
    if (!ud.modello) return;

    // Billboard: il gruppo guarda l'utente (label e anello sempre leggibili)
    group.lookAt(camera.position.x, group.position.y, camera.position.z);

    if (ud.isInfo) {
      // Info: rotazione lenta (sul modello, non sul gruppo)
      ud.modello.rotation.y = t * 0.7;
    } else {
      // Pointer: galleggiamento su/giù
      const oscill = Math.sin(t * 1.2 + ud.faseAnim) * 0.12;
      const base = ud.modello.userData.posBase;
      ud.modello.position.y = base.y + oscill;
    }
  });

  renderer.render(scene, camera);
}
animate();

inizializza();