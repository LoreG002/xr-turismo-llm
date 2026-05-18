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

const approfondimentiGroup = new THREE.Group();
scene.add(approfondimentiGroup);

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
// REFERENZE UI
// =====================================================
const btnChiudi = document.getElementById('btn-chiudi');
const pannello = document.getElementById('ui-panel');
const titoloEl = document.getElementById('titolo-luogo');
const testoEl = document.getElementById('testo-gemini');

function mostraPannello() {
  pannello.classList.add('visible');
}

function nascondiPannello() {
  pannello.classList.remove('visible');
}

// MODIFICA 1: Rimosso clearApprofondimenti() - I bottoni restano chiudendo il pannello
btnChiudi.addEventListener('click', () => {
  nascondiPannello();
});

// =====================================================
// STATO
// =====================================================
let scenaCorrente = null;
let tourData = null;

// =====================================================
// INIZIALIZZAZIONE
// =====================================================
async function inizializza() {
  const res = await fetch('/tour.json');
  tourData = await res.json();
  caricaScena('scena1');
}

// =====================================================
// HOTSPOT (info + navigazione)
// =====================================================
function creaHotspot(dati) {
  // Sfera dell'hotspot — raggio 0.4
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
// BOTTONI 3D CONTEXT-AWARE
// =====================================================
function creaBottoneApprofondimento(label, query, index, totale) {
  // Disposizione a terra, allineati orizzontalmente davanti all'utente
  const spaziatura = 3.5;
  const x = index * spaziatura - (totale - 1) * spaziatura / 2;
  const y = -3;       // a terra (sotto la linea dell'orizzonte)
  const z = -8;       // davanti all'utente

  // Bottone piccolo — raggio 0.25 (più piccolo dell'hotspot 0.4)
  const geo = new THREE.SphereGeometry(0.25, 24, 24);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xc084fc,
    transparent: true,
    opacity: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.userData = { tipo: 'approfondimento', label, query };

  // Anello luminoso attorno al bottone (effetto "tappabile")
  const ringGeo = new THREE.RingGeometry(0.35, 0.42, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xc084fc,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.lookAt(camera.position);
  mesh.add(ring);

  // Label sprite GRANDE e leggibile
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Sfondo arrotondato con gradiente
  const gradient = ctx.createLinearGradient(0, 0, 1024, 256);
  gradient.addColorStop(0, 'rgba(170, 59, 255, 0.92)');
  gradient.addColorStop(1, 'rgba(192, 132, 252, 0.92)');
  ctx.fillStyle = gradient;
  ctx.roundRect(0, 0, 1024, 256, 50);
  ctx.fill();

  // Bordo
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Testo label
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
  });
  const labelSprite = new THREE.Sprite(labelMat);
  labelSprite.scale.set(3, 0.75, 1);   // sprite grande
  labelSprite.position.set(0, 0.9, 0);  // sopra il pallino
  mesh.add(labelSprite);

  approfondimentiGroup.add(mesh);

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
  // Rimuovi anche le geometrie/textures per evitare memory leaks
  approfondimentiGroup.children.forEach(mesh => {
    mesh.geometry?.dispose();
    mesh.material?.dispose();
    mesh.children.forEach(child => {
      child.material?.map?.dispose();
      child.material?.dispose();
      child.geometry?.dispose();
    });
  });
  approfondimentiGroup.clear();
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
      clearApprofondimenti();
      scena.hotspot.forEach(h => creaHotspot(h));
      nascondiPannello();
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
  // Ignora click sulla UI HTML
  if (e.target.closest('#ui-panel')) return;

  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  // Considera SIA hotspot CHE approfondimenti
  const oggettiCliccabili = [
    ...hotspotGroup.children,
    ...approfondimentiGroup.children,
  ];
  const hits = raycaster.intersectObjects(oggettiCliccabili, true);

  if (hits.length === 0) return;

  // Risali l'albero per arrivare al mesh principale con userData.tipo
  let obj = hits[0].object;
  while (obj.parent && !obj.userData.tipo && !obj.userData.id) {
    obj = obj.parent;
  }
  const dati = obj.userData;

  // --- NAVIGAZIONE TRA SCENE ---
  if (dati.tipo === 'nav' || dati.destinazione) {
    clearApprofondimenti();
    caricaScena(dati.destinazione);
    return;
  }

  // --- HOTSPOT INFO → descrizione + spawn bottoni ---
  // MODIFICA 2: clearApprofondimenti() è già correttamente presente qui (nessuna modifica necessaria)
  if (dati.tipo === 'info') {
    clearApprofondimenti();
    mostraPannello();
    titoloEl.innerText = dati.label;
    testoEl.innerText = "Sto interpellando la guida storica...";

    const risposta = await fetchDescrizione(dati.query);
    testoEl.innerText = risposta.descrizione;

    // Spawn bottoni 3D context-aware (solo da hotspot info, NON ricorsivi)
    if (risposta.approfondimenti?.length > 0) {
      risposta.approfondimenti.forEach((app, i) => {
        creaBottoneApprofondimento(
          app.label,
          app.query,
          i,
          risposta.approfondimenti.length
        );
      });
    }
    return;
  }

  // --- BOTTONE APPROFONDIMENTO → solo descrizione, NIENTE altri bottoni ---
  // MODIFICA 3: Rimosso clearApprofondimenti() - I bottoni restano quando ne clicchi uno
  if (dati.tipo === 'approfondimento') {
    mostraPannello();
    titoloEl.innerText = dati.label;
    testoEl.innerText = "Approfondimento in corso...";

    const risposta = await fetchApprofondimento(dati.query);
    testoEl.innerText = risposta.descrizione;
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

  // Fai sempre guardare gli anelli dei bottoni verso la camera
  approfondimentiGroup.children.forEach(mesh => {
    mesh.children.forEach(child => {
      if (child.isMesh && child.geometry.type === 'RingGeometry') {
        child.lookAt(camera.position);
      }
    });
  });

  renderer.render(scene, camera);
}
animate();

inizializza();