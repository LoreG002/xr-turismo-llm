import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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

// =====================================================
// STATO
// =====================================================
let scenaCorrente = null;
let tourData = null;

// =====================================================
// PANNELLO GUIDA AI — 3D, FISSO NELLO SPAZIO
// =====================================================

const PANNELLO_W = 5.2;          // larghezza del piano (metri) — ingrandito

const PANNELLO_OFFSET_LAT = 4.6; // quanto il pannello si scosta di lato dall'hotspot
const PANNELLO_RAGGIO = 9;       // distanza del pannello dal centro scena (utente)

const CANVAS_W = 1024;           // risoluzione orizzontale del canvas

// Parametri dei bottoni di approfondimento integrati
const BTN_RAGGIO = 0.22;
const BTN_GAP_SOTTO = 0.7;       // distanza dei bottoni sotto il bordo del pannello

// Stato interno del pannello
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

  // --- Canvas + texture ---
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const pianoGeo = new THREE.PlaneGeometry(PANNELLO_W, PANNELLO_W);
  const pianoMat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const pianoMesh = new THREE.Mesh(pianoGeo, pianoMat);
  pianoMesh.renderOrder = 10;
  group.add(pianoMesh);

  const chiudiGeo = new THREE.SphereGeometry(0.18, 20, 20);
  const chiudiMat = new THREE.MeshBasicMaterial({
    color: 0xff5a7a,
    depthTest: false,
  });
  const chiudiMesh = new THREE.Mesh(chiudiGeo, chiudiMat);
  chiudiMesh.renderOrder = 11;
  chiudiMesh.userData = { tipo: 'chiudi_pannello' };


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

// --- roundRect con fallback ---
function rettArrotondato(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  // Fallback manuale
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function disegnaPannello(titolo, testo) {
  const { canvas, ctx, pianoMesh, chiudiMesh } = pannello3D;

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

  const altezzaTitolo = righeTitolo.length * INTERLINEA_TITOLO;
  const altezzaTesto = righeTesto.length * INTERLINEA_TESTO;
  const SPAZIO_TITOLO_TESTO = 28;
  const altezzaContenuto = altezzaTitolo + SPAZIO_TITOLO_TESTO + altezzaTesto;
  canvas.height = PAD * 2 + altezzaContenuto;


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

  ctx.fillStyle = '#d8b4fe';
  ctx.font = `bold ${FONT_TITOLO}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let y = PAD;
  for (const riga of righeTitolo) {
    ctx.fillText(riga, PAD, y);
    y += INTERLINEA_TITOLO;
  }

  y += SPAZIO_TITOLO_TESTO;
  ctx.fillStyle = 'rgba(243, 244, 246, 0.95)';
  ctx.font = `${FONT_TESTO}px sans-serif`;
  for (const riga of righeTesto) {
    ctx.fillText(riga, PAD, y);
    y += INTERLINEA_TESTO;
  }


  if (pannello3D.texture) pannello3D.texture.dispose();
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  pannello3D.texture = texture;
  pianoMesh.material.map = texture;
  pianoMesh.material.needsUpdate = true;

  const ratio = canvas.height / canvas.width;
  const altezzaPiano = PANNELLO_W * ratio;
  pannello3D.altezzaPiano = altezzaPiano;
  pianoMesh.geometry.dispose();
  pianoMesh.geometry = new THREE.PlaneGeometry(PANNELLO_W, altezzaPiano);

  chiudiMesh.position.set(
    PANNELLO_W / 2 - 0.05,
    altezzaPiano / 2 - 0.05,
    0.05
  );


  riposizionaBottoni();
}

function riposizionaBottoni() {
  const bottoni = pannello3D.bottoniGroup.children;
  const totale = bottoni.length;
  if (totale === 0) return;

  const y = -pannello3D.altezzaPiano / 2 - BTN_GAP_SOTTO;

  const spaziatura = PANNELLO_W / (totale + 1);

  bottoni.forEach((mesh, i) => {
    const x = spaziatura * (i + 1) - PANNELLO_W / 2;
    mesh.position.set(x, y, 0.05);
  });
}

// =====================================================
// BOTTONI 3D CONTEXT-AWARE (integrati nel pannello)
// =====================================================
function creaBottoneApprofondimento(label, query) {
  const geo = new THREE.SphereGeometry(BTN_RAGGIO, 24, 24);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xc084fc,
    transparent: true,
    opacity: 0,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 11;
  mesh.userData = { tipo: 'approfondimento', label, query };

  // Anello luminoso
  const ringGeo = new THREE.RingGeometry(0.30, 0.36, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xc084fc,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,
    depthTest: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.renderOrder = 11;
  mesh.add(ring);

  // Label sprite
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 1024, 256);
  gradient.addColorStop(0, 'rgba(170, 59, 255, 0.92)');
  gradient.addColorStop(1, 'rgba(192, 132, 252, 0.92)');
  ctx.fillStyle = gradient;
  ctx.roundRect(0, 0, 1024, 256, 50);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = 'white';
  ctx.font = 'bold 90px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 512, 128);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;

  const labelMat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0,
    depthTest: false,
  });
  const labelSprite = new THREE.Sprite(labelMat);
  labelSprite.scale.set(1.6, 0.4, 1);
  labelSprite.position.set(0, 0.5, 0);
  labelSprite.renderOrder = 12;
  mesh.add(labelSprite);

  pannello3D.bottoniGroup.add(mesh);

  // Fade-in animato
  let opacity = 0;
  const fadeIn = setInterval(() => {
    opacity += 0.06;
    mat.opacity = opacity;
    ringMat.opacity = opacity * 0.7;
    labelMat.opacity = opacity;
    if (opacity >= 1) clearInterval(fadeIn);
  }, 30);

  return mesh;
}

function clearApprofondimenti() {
  pannello3D.bottoniGroup.children.forEach(mesh => {
    mesh.geometry?.dispose();
    mesh.material?.dispose();
    mesh.children.forEach(child => {
      child.material?.map?.dispose();
      child.material?.dispose();
      child.geometry?.dispose();
    });
  });
  pannello3D.bottoniGroup.clear();
}


function posizionaPannelloAccantoA(posizioneHotspot) {
  const group = pannello3D.group;

  const lato = -1; // sempre a sinistra

  const dir = new THREE.Vector3(posizioneHotspot.x, 0, posizioneHotspot.z);
  if (dir.lengthSq() < 0.0001) dir.set(0, 0, -1);
  dir.normalize();

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

  clearApprofondimenti();
}

// =====================================================
// INIZIALIZZAZIONE
// =====================================================
async function inizializza() {
  creaPannello3D();
  const res = await fetch('/tour.json');
  tourData = await res.json();
  caricaScena('scena1');
}

// =====================================================
// HOTSPOT (info + navigazione)
// =====================================================
function creaHotspot(dati) {
  const geo = new THREE.SphereGeometry(0.4, 16, 16);
  const colore = dati.tipo === 'info' ? 0xffaa00 : 0x00aaff;
  const mat = new THREE.MeshBasicMaterial({ color: colore });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(dati.posizione.x, dati.posizione.y, dati.posizione.z);
  mesh.userData = dati;

  // Label canvas
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.roundRect(0, 0, 1024, 256, 40);
  ctx.fill();
  ctx.fillStyle = 'white';
  ctx.font = 'bold 85px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(dati.label, 512, 128);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;

  const labelMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const labelSprite = new THREE.Sprite(labelMat);
  labelSprite.scale.set(4, 1, 1);
  labelSprite.position.set(0, 1.2, 0);

  mesh.add(labelSprite);
  hotspotGroup.add(mesh);
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

  // Oggetti cliccabili: hotspot + chiudi e bottoni
  const oggettiCliccabili = [...hotspotGroup.children];
  if (pannello3D.group.visible) {
    oggettiCliccabili.push(pannello3D.chiudiMesh);
    oggettiCliccabili.push(...pannello3D.bottoniGroup.children);
  }
  const hits = raycaster.intersectObjects(oggettiCliccabili, true);

  if (hits.length === 0) return;

  // Risali l'albero fino al mesh principale con userData.tipo
  let obj = hits[0].object;
  while (obj.parent && !obj.userData.tipo && !obj.userData.id) {
    obj = obj.parent;
  }
  const dati = obj.userData;

  // --- CHIUSURA PANNELLO 3D ---
  if (dati.tipo === 'chiudi_pannello') {
    nascondiPannello();
    return;
  }

  // --- NAVIGAZIONE TRA SCENE ---
  if (dati.tipo === 'nav' || dati.destinazione) {
    caricaScena(dati.destinazione);
    return;
  }

  // --- HOTSPOT INFO ---
  if (dati.tipo === 'info') {
    clearApprofondimenti();
    posizionaPannelloAccantoA(obj.position);
    disegnaPannello(dati.label, "Sto interpellando la guida storica...");
    mostraPannello();

    const risposta = await fetchDescrizione(dati.query);

    if (risposta.approfondimenti?.length > 0) {
      risposta.approfondimenti.forEach((app) => {
        creaBottoneApprofondimento(app.label, app.query);
      });
    }
    disegnaPannello(dati.label, risposta.descrizione);
    return;
  }

  // --- BOTTONE APPROFONDIMENTO → solo descrizione ---
  if (dati.tipo === 'approfondimento') {
    disegnaPannello(dati.label, "Approfondimento in corso...");

    const risposta = await fetchApprofondimento(dati.query);
    disegnaPannello(dati.label, risposta.descrizione);
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
function animate() {
  requestAnimationFrame(animate);
  controls.update();

  if (pannello3D.group && pannello3D.group.visible) {
    pannello3D.group.lookAt(
      camera.position.x,
      pannello3D.group.position.y,
      camera.position.z
    );
  }

  renderer.render(scene, camera);
}
animate();

inizializza();