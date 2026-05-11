import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// setup scena
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Controlli mouse
const controls = new OrbitControls(camera, renderer.domElement);
camera.position.set(0, 0, 0.1); // Mettiamo la camera al centro esatto
controls.update();

// creazione sfera
const geometry = new THREE.SphereGeometry(500, 60, 40);
// Invertiamo la sfera per guardarla dall'interno!
geometry.scale(-1, 1, 1);

// Carichiamo la foto di esempio nella cartella public
const textureLoader = new THREE.TextureLoader();
const texture = textureLoader.load('/test360.jpg');
const material = new THREE.MeshBasicMaterial({ map: texture });

const sphere = new THREE.Mesh(geometry, material);
scene.add(sphere);

// animazione
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();


window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// integrazione con backend
const btnScopri = document.getElementById('btn-scopri');
const uiPanel = document.getElementById('ui-panel');
const testoGemini = document.getElementById('testo-gemini');

btnScopri.addEventListener('click', async () => {
    
    uiPanel.style.display = 'block';
    testoGemini.innerText = "Sto analizzando il luogo...";

    try {
        // Richiesta sul server locale (Frontend)
        // Per Jacopo e conch (aprite il terminale dentro backend e fate "python backend.py" 
        // poi aprite il terminale dentro frontend e fate "npm run dev"
        const response = await fetch('http://localhost:8000/spiegazione/Colosseo');
        const data = await response.json();
        
       
        testoGemini.innerText = data.text;
    } catch (error) {
        console.error("Errore di connessione col backend:", error);
        testoGemini.innerText = "Ops! Errore di connessione col server.";
    }
});