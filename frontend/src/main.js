import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// --- SETUP SCENA ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
camera.position.set(0, 0, 0.1);
controls.update();

// --- SFERA PANORAMICA ---
const geometry = new THREE.SphereGeometry(500, 60, 40);
geometry.scale(-1, 1, 1);
const material = new THREE.MeshBasicMaterial();
const sphere = new THREE.Mesh(geometry, material);
scene.add(sphere);

// --- HOTSPOT GROUP ---
const hotspotGroup = new THREE.Group();
scene.add(hotspotGroup);

// --- OVERLAY FADE ---
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

// --- ELEMENTI UI ---
const btnScopri = document.getElementById('btn-scopri');
const btnChiudi = document.getElementById('btn-chiudi');
const pannello = document.getElementById('ui-panel');
const titoloEl = document.getElementById('titolo-luogo');
const testoEl = document.getElementById('testo-gemini');

btnChiudi.addEventListener('click', () => pannello.style.display = 'none');

// --- STATO ---
let scenaCorrente = null;
let tourData = null;

// --- INIT ---
async function inizializza() {
  const res = await fetch('/tour.json');
  tourData = await res.json();
  caricaScena('scena1');
}

// --- HOTSPOT (solo navigazione) ---
function creaHotspot(dati) {
  const geo = new THREE.SphereGeometry(0.4, 16, 16);

  //qua diamo un colore al pallino se è di info o se è di spostamento
  const colore = dati.tipo ==='info'? 0xffaa00 : 0x00aaff;

  const mat = new THREE.MeshBasicMaterial({ color: colore});

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(dati.posizione.x, dati.posizione.y, dati.posizione.z);
  mesh.userData = dati;

  // Label
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.roundRect(0, 0, 1024, 256, 40);
  ctx.fill();
  ctx.fillStyle = 'white';
  ctx.font = 'bold 72px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(dati.label, 512, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const labelMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), labelMat);
  labelMesh.position.set(0, 1.2, 0);
  mesh.add(labelMesh);

  hotspotGroup.add(mesh);
}

// --- CARICA SCENA ---
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
      scena.hotspot.forEach(h => creaHotspot(h));
      pannello.style.display = 'none';
      overlay.style.opacity = 0;
    });
  }, 500);
}

// --- FETCH LLM ---
async function fetchDescrizione(luogo_id) {
  try {
    const res = await fetch(`http://localhost:8000/spiegazione/${encodeURIComponent(luogo_id)}`);
    const data = await res.json();
    return data.text;
  } catch {
    return "Errore di connessione con il backend.";
  }
}

/* --- BOTTONE "Cosa sto guardando?" ---
btnScopri.addEventListener('click', async () => {
  if (!scenaCorrente) return;
  pannello.style.display = 'block';
  titoloEl.innerText = scenaCorrente.nome;
  testoEl.innerText = "Sto analizzando il luogo...";
  const testo = await fetchDescrizione(scenaCorrente.luogo_id);
  testoEl.innerText = testo;
});*/

// --- CLICK HOTSPOT ---
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

window.addEventListener('click', (e) => {
  if (e.target.closest('#ui-panel') || e.target.closest('#btn-scopri')) return;

  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(hotspotGroup.children, true);
/*
  if (hits.length > 0) {
    let obj = hits[0].object;
    while (obj.parent && !obj.userData.destinazione) obj = obj.parent;
    if (obj.userData.destinazione) {
      caricaScena(obj.userData.destinazione);
    }
  }
});*/

if (hits.length > 0) {
    let obj = hits[0].object;
    
    // Risaliamo l'albero per assicurarci di leggere i userData del pallino principale
    while (obj.parent && !obj.userData.id) obj = obj.parent;
    
    const dati = obj.userData;

    if (dati.tipo === 'nav' || dati.destinazione) {
      // Cambio Scena
      caricaScena(dati.destinazione);
    } else if (dati.tipo === 'info') {
      // Chiamata LLM
      pannello.style.display = 'block';
      titoloEl.innerText = dati.label;
      testoEl.innerText = "Sto interpellando la guida storica...";
      
      fetchDescrizione(dati.query).then(testo => {
        testoEl.innerText = testo;
      });
    }
  }
});


// --- RESIZE ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- LOOP ---
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

inizializza();