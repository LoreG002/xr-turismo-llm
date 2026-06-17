import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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

const ambientLight = new THREE.AmbientLight(0xffffff, 1.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.3);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);

const dirLightFill = new THREE.DirectionalLight(0xffffff, 0.9);
dirLightFill.position.set(-6, -3, -8);
scene.add(dirLightFill);

const hotspotGroup = new THREE.Group();
scene.add(hotspotGroup);

// Overlay nero per il fade tra una scena e l'altra
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

const HOTSPOT_ALTEZZA_INFO = 0.8;
const HOTSPOT_ALTEZZA_INFO_SEC = 0.6;
const HOTSPOT_ALTEZZA_NAV = 1.05;
const HOTSPOT_ANELLO_INNER = 0.5;
const HOTSPOT_ANELLO_OUTER = 0.65;
const HOTSPOT_ANELLO_INNER_SEC = 0.38;
const HOTSPOT_ANELLO_OUTER_SEC = 0.50;
let scenaCorrente = null;
let idScenaCorrente = null;
let tourData = null;

const modelli = {
  infoSign: null,
  infoSignSecondario: null,
  mapPointer: null,
};

// Pannello guida AI: pannello 3D fisso nello spazio, affiancato alla camera
const PANNELLO_W = 5.2;
const PANNELLO_OFFSET_LAT = 4.6;
const PANNELLO_RAGGIO = 9;

const CANVAS_W = 1024;

const SCHEDA_GAP = 0.04;
const SCHEDA_H = 0.82;
const SCHEDA_SPORGENZA = 0.62;
const SCHEDA_SOVRAPP = 0.06;

// Pannello foto, mostrato accanto al pannello testo
const PANNELLO_FOTO_W = 4.4;
const PANNELLO_FOTO_H = 4.4;
const PANNELLO_FOTO_GAP = 0.5;
const FOTO_BASE_PATH = '/pic/';

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

const pannelloFoto = {
  group: null,
  pianoMesh: null,
  cornice: null,
  texture: null,
  targetOpacity: 0,
  fileCorrente: null,
};

function creaPannello3D() {
  const group = new THREE.Group();

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

  // Bottone chiudi
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
  const schede = pannello3D.bottoniGroup.children;
  const totale = schede.length;
  if (totale === 0) return;

  const larghezzaScheda = (PANNELLO_W - SCHEDA_GAP * (totale - 1)) / totale;
  const bordoInferiore = -pannello3D.altezzaPiano / 2;
  const centroY = bordoInferiore + SCHEDA_SOVRAPP - SCHEDA_H / 2;

  schede.forEach((mesh, i) => {
    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(larghezzaScheda, SCHEDA_H);

    const x = -PANNELLO_W / 2 + larghezzaScheda / 2 + i * (larghezzaScheda + SCHEDA_GAP);
    mesh.userData.targetY = centroY;
    mesh.position.set(x, centroY, 0.02);

    disegnaScheda(mesh);
  });
}

function disegnaScheda(mesh) {
  const { label, selezionata } = mesh.userData;
  const canvas = mesh.userData.canvas;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const R = 36;

  ctx.clearRect(0, 0, W, H);

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  if (selezionata) {
    grad.addColorStop(0, 'rgba(170, 90, 255, 0.95)');
    grad.addColorStop(1, 'rgba(120, 60, 200, 0.95)');
  } else {
    grad.addColorStop(0, 'rgba(60, 35, 100, 0.88)');
    grad.addColorStop(1, 'rgba(35, 22, 65, 0.92)');
  }
  ctx.fillStyle = grad;

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, H - R);
  ctx.arcTo(W, H, W - R, H, R);
  ctx.lineTo(R, H);
  ctx.arcTo(0, H, 0, H - R, R);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = selezionata ? 'rgba(230, 200, 255, 0.9)' : 'rgba(192, 132, 252, 0.4)';
  ctx.lineWidth = selezionata ? 5 : 3;
  ctx.stroke();

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

function creaBottoneApprofondimento(label, query) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

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

function posizionaPannelloAccantoA(posizioneHotspot) {
  const group = pannello3D.group;
  const lato = -1;
  const dir = new THREE.Vector3(posizioneHotspot.x, 0, posizioneHotspot.z);
  if (dir.lengthSq() < 0.0001) dir.set(0, 0, -1);
  dir.normalize();

  const destra = new THREE.Vector3(-dir.z, 0, dir.x);
  const pos = dir.clone().multiplyScalar(PANNELLO_RAGGIO).add(destra.multiplyScalar(lato * PANNELLO_OFFSET_LAT));
  pos.y = posizioneHotspot.y - 0.5;

  group.position.copy(pos);
}

function mostraPannello() {
  pannello3D.group.visible = true;
}

function nascondiPannello() {
  pannello3D.group.visible = false;
  clearApprofondimenti();
  nascondiFoto();
}

function creaAlphaMapArrotondato() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  rettArrotondato(ctx, 0, 0, canvas.width, canvas.height, 40);
  ctx.fillStyle = 'white';
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function creaPannelloFoto() {
  const group = new THREE.Group();
  const alphaMap = creaAlphaMapArrotondato();

  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = 1024;
  bgCanvas.height = 1024;
  const bgCtx = bgCanvas.getContext('2d');

  function disegnaCorniceFoto(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, 'rgba(40, 20, 70, 0.92)');
    grad.addColorStop(1, 'rgba(20, 15, 40, 0.95)');
    ctx.fillStyle = grad;
    rettArrotondato(ctx, 0, 0, w, h, 40);
    ctx.fill();
    ctx.strokeStyle = 'rgba(192, 132, 252, 0.45)';
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  disegnaCorniceFoto(bgCtx, bgCanvas.width, bgCanvas.height);
  const bgTex = new THREE.CanvasTexture(bgCanvas);
  bgTex.minFilter = THREE.LinearFilter;
  bgTex.magFilter = THREE.LinearFilter;

  const sfondoGeo = new THREE.PlaneGeometry(PANNELLO_FOTO_W, PANNELLO_FOTO_H);
  const sfondoMat = new THREE.MeshBasicMaterial({
    map: bgTex,
    transparent: true,
    opacity: 0,
    depthTest: false,
    alphaMap,
  });
  const sfondoMesh = new THREE.Mesh(sfondoGeo, sfondoMat);
  sfondoMesh.renderOrder = 10;
  sfondoMesh.position.z = -0.002;
  group.add(sfondoMesh);

  const PAD = 0.15;
  const pianoGeo = new THREE.PlaneGeometry(PANNELLO_FOTO_W - PAD * 2, PANNELLO_FOTO_H - PAD * 2);
  const pianoMat = new THREE.MeshBasicMaterial({
    color: 0x111111,
    transparent: true,
    opacity: 0,
    depthTest: false,
    alphaMap,
  });
  const pianoMesh = new THREE.Mesh(pianoGeo, pianoMat);
  pianoMesh.renderOrder = 11;
  group.add(pianoMesh);

  group.visible = false;
  scene.add(group);

  pannelloFoto.group = group;
  pannelloFoto.pianoMesh = pianoMesh;
  pannelloFoto.sfondoMesh = sfondoMesh;
  pannelloFoto.alphaMap = alphaMap;
  pannelloFoto.bgCanvas = bgCanvas;
  pannelloFoto.bgCtx = bgCtx;
  pannelloFoto.disegnaCorniceFoto = disegnaCorniceFoto;
}

const fotoLoader = new THREE.TextureLoader();

function mostraFoto(nomeFile) {
  if (!pannelloFoto.group) return;
  if (!nomeFile) { nascondiFoto(); return; }
  if (pannelloFoto.fileCorrente === nomeFile && pannelloFoto.group.visible) return;

  const url = FOTO_BASE_PATH + nomeFile;
  fotoLoader.load(
    url,
    (tex) => {
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.colorSpace = THREE.SRGBColorSpace;

      const img = tex.image;
      if (img && img.width && img.height) {
        const ratio = img.height / img.width;
        const h = PANNELLO_FOTO_W * ratio;
        const PAD = 0;
        const { pianoMesh, sfondoMesh, bgCanvas, bgCtx, disegnaCorniceFoto } = pannelloFoto;

        pianoMesh.geometry.dispose();
        pianoMesh.geometry = new THREE.PlaneGeometry(PANNELLO_FOTO_W - PAD * 2, h - PAD * 2);
        sfondoMesh.geometry.dispose();
        sfondoMesh.geometry = new THREE.PlaneGeometry(PANNELLO_FOTO_W, h);

        disegnaCorniceFoto(bgCtx, bgCanvas.width, bgCanvas.height);
        sfondoMesh.material.map.needsUpdate = true;
      }

      if (pannelloFoto.texture) pannelloFoto.texture.dispose();
      pannelloFoto.texture = tex;

      const mat = pannelloFoto.pianoMesh.material;
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;

      pannelloFoto.fileCorrente = nomeFile;
      pannelloFoto.group.visible = true;
      pannelloFoto.targetOpacity = 1;
      posizionaPannelloFotoAccantoAlTesto();
    },
    undefined,
    (err) => {
      console.warn(`[pannelloFoto] Impossibile caricare ${url}:`, err);
      nascondiFoto();
    },
  );
}

function nascondiFoto() {
  if (!pannelloFoto.group) return;
  pannelloFoto.targetOpacity = 0;
  pannelloFoto.fileCorrente = null;
}

function posizionaPannelloFotoAccantoAlTesto() {
  if (!pannelloFoto.group || !pannello3D.group) return;
  const pos = pannello3D.group.position.clone();
  const dirCamToPanel = new THREE.Vector3(pos.x - camera.position.x, 0, pos.z - camera.position.z);
  if (dirCamToPanel.lengthSq() < 0.0001) dirCamToPanel.set(0, 0, -1);
  dirCamToPanel.normalize();

  const sinistra = new THREE.Vector3(-dirCamToPanel.z, 0, dirCamToPanel.x);
  const offset = (PANNELLO_W / 2) + PANNELLO_FOTO_GAP + (PANNELLO_FOTO_W / 2);

  pannelloFoto.group.position.set(
    pos.x - sinistra.x * offset,
    pos.y,
    pos.z - sinistra.z * offset
  );
}

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
    ricoloraModello(modelli.infoSign, { colore: 0xffcc33, emissivo: 0xffaa00, emissiveIntensity: 0.9, opacita: 0.82 });

    const infoSecRes = await loader.loadAsync('/models/highpoly_info_sign_3d_icon.glb');
    modelli.infoSignSecondario = infoSecRes.scene;
    ricoloraModello(modelli.infoSignSecondario, { colore: 0xff8833, emissivo: 0xff5500, emissiveIntensity: 0.95, opacita: 0.82 });

    const navRes = await loader.loadAsync('/models/map_pointer_3d_icon.glb');
    modelli.mapPointer = navRes.scene;
    ricoloraModello(modelli.mapPointer, { colore: 0x33aaff, emissivo: 0x0077cc, emissiveIntensity: 0.4, opacita: 0.82 });
  } catch (err) {
    console.error('Errore caricamento modelli GLB:', err);
  }
}

async function inizializza() {
  creaPannello3D();
  creaPannelloFoto();
  await caricaModelliGLB();
  const res = await fetch('/tour.json');
  tourData = await res.json();
  caricaScena('Duomo1');
}

function disegnaLabelHotspot(testo, isInfo, isInfoSec = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const R = 80;

  ctx.clearRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, 'rgba(40, 20, 70, 0.82)');
  grad.addColorStop(1, 'rgba(20, 15, 40, 0.88)');
  ctx.fillStyle = grad;
  rettArrotondato(ctx, 8, 8, W - 16, H - 16, R);
  ctx.fill();

  let bordo = isInfoSec ? 'rgba(255, 140, 80, 0.65)' : (isInfo ? 'rgba(255, 200, 120, 0.55)' : 'rgba(130, 200, 255, 0.55)');
  ctx.strokeStyle = bordo;
  ctx.lineWidth = 5;
  ctx.stroke();

  let accento = isInfoSec ? '#ff8844' : (isInfo ? '#ffb84d' : '#5ec6ff');
  ctx.fillStyle = accento;
  ctx.beginPath();
  ctx.arc(110, H / 2, 26, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f3f4f6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const margineSx = 170; const margineDx = 70;
  const larghezzaTesto = W - margineSx - margineDx;
  const centroX = margineSx + larghezzaTesto / 2;

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

function disegnaLabelChevron(testo) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 192;
  const ctx = canvas.getContext('2d');
  const W = canvas.width; const H = canvas.height;

  const PAD_X = 60; const FONT_SIZE = 64;
  ctx.font = `500 ${FONT_SIZE}px sans-serif`;
  const larghezzaTestoEffettiva = ctx.measureText(testo).width;
  const larghezzaPillola = Math.min(W - 40, larghezzaTestoEffettiva + PAD_X * 2);
  const altezzaPillola = 110;

  const xPillola = (W - larghezzaPillola) / 2;
  const yPillola = (H - altezzaPillola) / 2;
  const raggio = altezzaPillola / 2;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
  rettArrotondato(ctx, xPillola, yPillola, larghezzaPillola, altezzaPillola, raggio);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(testo, W / 2, H / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

// Frecce chevron per la navigazione locale (stesso monumento, foto diverse)
const CHEVRON_DIM = 0.9;
const CHEVRON_SPESSORE = 0.32;
const CHEVRON_PITCH_DEFAULT = -Math.PI / 2.4;

function creaChevronMesh(opacityBase) {
  const s = CHEVRON_DIM; const k = CHEVRON_SPESSORE;
  const shape = new THREE.Shape();
  shape.moveTo(-s, -s); shape.lineTo(0, -s); shape.lineTo(s, 0); shape.lineTo(0, s); shape.lineTo(-s, s); shape.lineTo(-s + k, 0); shape.lineTo(-s, -s);

  const geo = new THREE.ShapeGeometry(shape);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: opacityBase, side: THREE.DoubleSide, depthTest: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 8;
  return mesh;
}

// Crea un hotspot di qualsiasi tipo (nav_locale, nav, info, info_secondario)
function creaHotspot(dati, _src = null, _container = null) {
  if (dati.tipo === 'nav_locale') {
    const group = new THREE.Group();
    const gruppoChevrons = new THREE.Group();
    const chevPrim = creaChevronMesh(0.85);
    const chevEco = creaChevronMesh(0.45);
    chevEco.position.x = 0.55;
    chevEco.scale.setScalar(0.85);
    gruppoChevrons.add(chevPrim);
    gruppoChevrons.add(chevEco);

    const yawAuto = Math.atan2(dati.posizione.x, -dati.posizione.z);
    let rotX = CHEVRON_PITCH_DEFAULT; let rotY = yawAuto; let rotZ = 0;
    const rot = dati.rotazione;
    if (typeof rot === 'number') { rotY = rot; }
    else if (rot && typeof rot === 'object') {
      if (typeof rot.x === 'number') rotX = rot.x;
      if (typeof rot.y === 'number') rotY = rot.y;
      if (typeof rot.z === 'number') rotZ = rot.z;
    }
    gruppoChevrons.rotation.set(rotX, rotY, rotZ);
    group.add(gruppoChevrons);

    let labelSprite = null;
    if (dati.label) {
      const tex = disegnaLabelChevron(dati.label);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      labelSprite = new THREE.Sprite(mat);
      labelSprite.scale.set(2.6, 0.49, 1);
      labelSprite.position.set(0, 1.4, 0);
      labelSprite.renderOrder = 9;
      group.add(labelSprite);
    }

    group.position.set(dati.posizione.x, dati.posizione.y, dati.posizione.z);
    group.userData = { ...dati, isNavLocale: true, chevronPrim: chevPrim, chevronEco: chevEco, chevronGroup: gruppoChevrons, labelSprite: labelSprite, faseAnim: Math.random() * Math.PI * 2, _src, _container };
    hotspotGroup.add(group);
    return;
  }

  const isInfoSec = dati.tipo === 'info_secondario';
  const isInfo = dati.tipo === 'info' || isInfoSec;

  let modello = isInfoSec ? modelli.infoSignSecondario : (isInfo ? modelli.infoSign : modelli.mapPointer);
  let altezzaTarget = isInfoSec ? HOTSPOT_ALTEZZA_INFO_SEC : (isInfo ? HOTSPOT_ALTEZZA_INFO : HOTSPOT_ALTEZZA_NAV);
  let coloreAccento = isInfoSec ? 0xff7722 : (isInfo ? 0xffaa00 : 0x00aaff);

  let group = new THREE.Group();
  let modelloClone = null;
  if (modello) {
    const clone = modello.clone();
    const bbox = new THREE.Box3().setFromObject(clone);
    const dimensioni = new THREE.Vector3();
    bbox.getSize(dimensioni);
    const altezzaAttuale = dimensioni.y || 1;
    const fattore = altezzaTarget / altezzaAttuale;
    clone.scale.setScalar(fattore);

    const bboxScalato = new THREE.Box3().setFromObject(clone);
    const centro = new THREE.Vector3();
    bboxScalato.getCenter(centro);
    clone.position.sub(centro);
    clone.userData.posBase = clone.position.clone();

    group.add(clone);
    modelloClone = clone;
  } else {
    const geo = new THREE.SphereGeometry(0.4, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: coloreAccento });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.posBase = mesh.position.clone();
    group.add(mesh);
    modelloClone = mesh;
  }

  group.position.set(dati.posizione.x, dati.posizione.y, dati.posizione.z);
  group.userData = { ...dati, isInfo, isInfoSec, modello: modelloClone, centroY: dati.posizione.y, faseAnim: Math.random() * Math.PI * 2, _src, _container };

  const anelloInner = isInfoSec ? HOTSPOT_ANELLO_INNER_SEC : HOTSPOT_ANELLO_INNER;
  const anelloOuter = isInfoSec ? HOTSPOT_ANELLO_OUTER_SEC : HOTSPOT_ANELLO_OUTER;
  const anelloGeo = new THREE.RingGeometry(anelloInner, anelloOuter, 32);
  const anelloMat = new THREE.MeshBasicMaterial({ color: coloreAccento, side: THREE.DoubleSide, transparent: true, opacity: 0.6, depthTest: false });
  const anello = new THREE.Mesh(anelloGeo, anelloMat);
  anello.renderOrder = 9;
  anello.userData.isAnello = true;
  group.add(anello);

  const tex = disegnaLabelHotspot(dati.label, isInfo, isInfoSec);
  const labelMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const labelSprite = new THREE.Sprite(labelMat);
  const labelScale = isInfoSec ? 3.2 : 4;
  labelSprite.scale.set(labelScale, labelScale / 4, 1);
  labelSprite.position.set(0, isInfoSec ? 0.95 : 1.2, 0);

  group.add(labelSprite);
  hotspotGroup.add(group);
}

function costruisciHotspotScena(scena) {
  scena.hotspot.forEach(h => {
    creaHotspot(h, h, scena.hotspot);
    if (h.secondari && Array.isArray(h.secondari)) {
      h.secondari.forEach(sec => {
        creaHotspot({ ...sec, tipo: 'info_secondario' }, sec, h.secondari);
      });
    }
  });
}

const textureLoader = new THREE.TextureLoader();

function caricaScena(idScena, yawOverride) {
  const scena = tourData.scene[idScena];
  scenaCorrente = scena;
  idScenaCorrente = idScena;
  overlay.style.opacity = 1;

  setTimeout(() => {
    textureLoader.load(scena.panorama, (texture) => {
      material.map = texture;
      material.needsUpdate = true;

      const rotazioneY = (typeof yawOverride === 'number') ? yawOverride : (scena.rotazioneInizialeY || 0);
      controls.target.set(0, 0, -1);
      const targetX = Math.sin(rotazioneY);
      const targetZ = -Math.cos(rotazioneY);
      controls.target.set(targetX, 0, targetZ);
      camera.position.set(0, 0, 0.1);
      controls.update();

      hotspotGroup.clear();
      nascondiPannello();

      costruisciHotspotScena(scena);

      overlay.style.opacity = 0;
    });
  }, 500);
}

// Chiamate backend API
async function fetchDescrizione(luogo_id) {
  try { const res = await fetch(`http://localhost:8000/spiegazione/${encodeURIComponent(luogo_id)}`); return await res.json(); }
  catch { return { descrizione: "Errore di connessione con il backend.", approfondimenti: [] }; }
}
async function fetchApprofondimento(argomento) {
  try { const res = await fetch(`http://localhost:8000/approfondimento/${encodeURIComponent(argomento)}`); return await res.json(); }
  catch { return { descrizione: "Errore di connessione." }; }
}
async function fetchInfoRapida(argomento) {
  try { const res = await fetch(`http://localhost:8000/info_rapida/${encodeURIComponent(argomento)}`); return await res.json(); }
  catch { return { descrizione: "Errore di connessione." }; }
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

window.addEventListener('click', async (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const oggettiCliccabili = [...hotspotGroup.children];
  if (pannello3D.group.visible) {
    oggettiCliccabili.push(pannello3D.chiudiMesh);
    oggettiCliccabili.push(...pannello3D.bottoniGroup.children);
  }
  const hits = raycaster.intersectObjects(oggettiCliccabili, true);

  if (hits.length === 0) return;

  let obj = hits[0].object;
  while (obj.parent && !obj.userData.tipo && !obj.userData.id) {
    obj = obj.parent;
  }
  const dati = obj.userData;

  if (dati.tipo === 'chiudi_pannello') { nascondiPannello(); return; }

  if (dati.tipo === 'nav' || dati.destinazione) {
    const yaw = (typeof dati.yawArrivo === 'number') ? dati.yawArrivo : undefined;
    caricaScena(dati.destinazione, yaw);
    return;
  }

  if (dati.tipo === 'info_secondario') {
    clearApprofondimenti(); nascondiFoto();
    posizionaPannelloAccantoA(obj.position);
    disegnaPannello(dati.label, "Sto interpellando la guida..."); mostraPannello();
    const risposta = await fetchInfoRapida(dati.query);
    disegnaPannello(dati.label, risposta.descrizione);
    return;
  }

  if (dati.tipo === 'info') {
    clearApprofondimenti(); nascondiFoto();
    posizionaPannelloAccantoA(obj.position);
    disegnaPannello(dati.label, "Sto interpellando la guida storica..."); mostraPannello();
    const risposta = await fetchDescrizione(dati.query);
    if (risposta.approfondimenti?.length > 0) {
      risposta.approfondimenti.forEach((app) => { creaBottoneApprofondimento(app.label, app.query); });
    }
    disegnaPannello(dati.label, risposta.descrizione || risposta.descrizione);
    return;
  }

  if (dati.tipo === 'approfondimento') {
    selezionaScheda(obj); disegnaPannello(dati.label, "Approfondimento in corso...");
    selezionaScheda(obj); nascondiFoto();
    const risposta = await fetchApprofondimento(dati.query);
    disegnaPannello(dati.label, risposta.descrizione);
    selezionaScheda(obj); mostraFoto(risposta.immagine);
    return;
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  controls.update();

  const t = clock.getElapsedTime();

  if (pannello3D.group && pannello3D.group.visible) {
    pannello3D.group.lookAt(camera.position.x, pannello3D.group.position.y, camera.position.z);
  }

  if (pannelloFoto.group) {
    const matPiano = pannelloFoto.pianoMesh.material;
    const matSfondo = pannelloFoto.sfondoMesh.material;
    const target = pannelloFoto.targetOpacity;
    matPiano.opacity += (target - matPiano.opacity) * 0.12;
    matSfondo.opacity += (target - matSfondo.opacity) * 0.12;

    if (target === 0 && matPiano.opacity < 0.02) {
      matPiano.opacity = 0; matSfondo.opacity = 0;
      pannelloFoto.group.visible = false;
    } else if (target > 0) {
      pannelloFoto.group.visible = true;
    }

    if (pannelloFoto.group.visible) {
      posizionaPannelloFotoAccantoAlTesto();
      pannelloFoto.group.lookAt(camera.position.x, pannelloFoto.group.position.y, camera.position.z);
    }
  }

  hotspotGroup.children.forEach(group => {
    const ud = group.userData;
    if (ud.isNavLocale) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.0 + ud.faseAnim);
      ud.chevronPrim.material.opacity = 0.55 + 0.35 * pulse;
      ud.chevronEco.material.opacity = 0.20 + 0.30 * pulse;
      return;
    }
    if (!ud.modello) return;

    group.lookAt(camera.position.x, group.position.y, camera.position.z);

    if (ud.isInfo) {
      ud.modello.rotation.y = t * 0.7;
    } else {
      const oscill = Math.sin(t * 1.2 + ud.faseAnim) * 0.12;
      const base = ud.modello.userData.posBase;
      ud.modello.position.y = base.y + oscill;
    }
  });

  renderer.render(scene, camera);
}
animate();

inizializza();

// Doppio click per riposizionamento rapido: stampa in console le coordinate del punto
// puntato dal raggio, da copiare a mano in tour.json
window.addEventListener('dblclick', (e) => {
  const mouseX = (e.clientX / window.innerWidth) * 2 - 1;
  const mouseY = -(e.clientY / window.innerHeight) * 2 + 1;

  const tempRaycaster = new THREE.Raycaster();
  tempRaycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera);
  const distanza = 10;
  const posizione = new THREE.Vector3().copy(tempRaycaster.ray.direction).multiplyScalar(distanza);

  console.log(`"posizione": { "x": ${posizione.x.toFixed(2)}, "y": ${posizione.y.toFixed(2)}, "z": ${posizione.z.toFixed(2)} }`);
});

window.addEventListener('keydown', (e) => {
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

  if (e.key === 'r' || e.key === 'R') {
    if (!controls) return;
    const direzione = new THREE.Vector3();
    camera.getWorldDirection(direzione);
    let angoloRadianti = Math.atan2(direzione.x, -direzione.z);
    console.log(`"rotazioneInizialeY": ${angoloRadianti.toFixed(2)}`);
  }
});