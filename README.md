# XR Tour Ancona — Guida turistica immersiva con RAG e LLM

> Progetto universitario — Corso di Computer Graphics & Multimedia, A.A. 2025/26  
> Supervisori: Prof. Primo Zingaretti, Prof. Lorenzo Stacchio, Prof. Claudio Sirocchi · Università Politecnica delle Marche

Il progetto è un tour virtuale a 360° dei principali monumenti di Ancona, arricchito da una guida culturale AI che genera descrizioni e approfondimenti in tempo reale a partire da fonti documentali, con immagini di dettaglio sincronizzate. L'utente naviga tra sequenze di panorami sferici cliccando hotspot 3D in stile Street View, e per ogni monumento può interrogare la guida AI per ottenere:

- una **descrizione narrativa** del luogo con tre schede di approfondimento tematico,
- un **approfondimento** su ciascuna scheda, generato via RAG sul corpus testuale e accompagnato da una **foto di dettaglio** scelta automaticamente dal modello,
- **info rapide** su soggetti secondari della scena (statue, porte, mosaici) senza retrieval, per risposte più leggere e istantanee.

---

## Indice

1. [Panoramica delle scene](#panoramica-delle-scene)
2. [Architettura](#architettura)
3. [Struttura del repository](#struttura-del-repository)
4. [Componenti principali](#componenti-principali)
5. [Strumenti di sviluppo](#strumenti-di-sviluppo)
6. [Requisiti](#requisiti)
7. [Installazione e avvio](#installazione-e-avvio)
8. [Note operative](#note-operative)
9. [Limiti e possibili sviluppi](#limiti-e-possibili-sviluppi)

---

## Panoramica delle scene

Il tour è composto da **7 luoghi** principali, 5 dei quali sono navigabili internamente tramite sequenze di più panorami 360° collegati (navigazione intra-scena in stile Street View). Le scene statiche constano di un singolo panorama.

| # | Luogo | Tipo | Panorami |
|---|---|---|---|
| 1 | Duomo di San Ciriaco | navigabile | 5 (Sagrato, Portale, Abside, Campanile, Largo Giovanni Paolo II) |
| 2 | Arco di Traiano | navigabile | 7 (Strada, Vicino arco, Cannoni, Attraversato, Bastione, Panoramica, Rovine) |
| 3 | Mole Vanvitelliana | navigabile | 3 (Esterno Porta Pia, Colonnato, Cortile) |
| 4 | Piazza del Plebiscito (Piazza del Papa) | navigabile | 4 (Centro, Piazzetta, Scalinata, Facciata chiesa) |
| 5 | Santa Maria della Piazza | navigabile | 2 (Facciata, Sotterranei) |
| 6 | Piazza Cavour | statica | 1 |
| 7 | Il Passetto | statica | 1 |

### Grafo di navigazione globale

I collegamenti tra i 7 luoghi sono tutti bidirezionali e implementati tramite hotspot `nav` (puntatori 3D blu). I seguenti archi costituiscono il grafo del tour:

```
Duomo ──── Santa Maria della Piazza
Duomo ──── Arco di Traiano
Arco di Traiano ──── Mole Vanvitelliana
Mole Vanvitelliana ──── Santa Maria della Piazza
Mole Vanvitelliana ──── Piazza del Papa
Santa Maria della Piazza ──── Piazza del Papa
Piazza del Papa ──── Piazza Cavour
Piazza Cavour ──── Il Passetto
```

### Tipi di hotspot

| Tipo | Modello | Funzione |
|---|---|---|
| `nav` | Puntatore 3D blu | Salta a un altro luogo del tour (navigazione globale) |
| `nav_locale` | Freccia chevron semi-trasparente a terra | Passa al panorama successivo/precedente nello stesso luogo |
| `info` | Icona segnaletica gialla | Apre il pannello guida AI con descrizione + 3 schede RAG |
| `info_secondario` | Icona segnaletica arancione (più piccola) | Apre una descrizione breve via LLM diretto, senza RAG |

**Regola di completezza delle sotto-scene:** ogni sotto-panorama di un luogo navigabile espone sempre l'identico set di hotspot `nav` globali e `info` primari, in modo che la guida e i collegamenti siano accessibili da qualsiasi punto della sequenza.

---

## Architettura

```
                       ┌─────────────────────────────────┐
                       │           FRONTEND              │
                       │   Three.js r172 + Vite          │
                       │           porta 5173            │
                       │                                 │
                       │  · Sfera panoramica 360°        │
                       │  · Hotspot 3D (GLB + chevron)   │
                       │  · Pannello guida AI in 3D      │
                       │  · Pannello foto laterale       │
                       └─────────────┬───────────────────┘
                                     │ HTTP (JSON)
                                     ▼
                       ┌─────────────────────────────────┐
                       │           BACKEND               │
                       │   FastAPI + Uvicorn             │
                       │           porta 8000            │
                       │                                 │
                       │  /spiegazione/{luogo}           │
                       │  /approfondimento/{argomento}   │
                       │  /info_rapida/{argomento}       │
                       └─────────┬───────────────┬───────┘
                                 │               │
                                 ▼               ▼
                       ┌─────────────────┐  ┌──────────────────┐
                       │      RAG        │  │      Groq        │
                       │ FAISS + e5-base │  │  Llama 3.1 8B /  │
                       │  corpus/*.txt   │  │  Llama 3.3 70B   │
                       └─────────────────┘  └──────────────────┘
```

### Stack tecnologico

**Frontend**
- [Three.js r172](https://threejs.org/) per il rendering WebGL della scena 3D (versione r172 richiesta per compatibilità con il Chrome WebXR API Emulator)
- [Vite](https://vitejs.dev/) come dev server e bundler
- `GLTFLoader` per il caricamento dei modelli 3D GLB degli hotspot
- `WebXR API` tramite `renderer.setAnimationLoop` per compatibilità con visori VR

**Backend**
- [FastAPI](https://fastapi.tiangolo.com/) + [Uvicorn](https://www.uvicorn.org/) come framework web asincrono
- [Groq](https://groq.com/) come provider LLM (Llama 3.1 8B Instant per velocità; Llama 3.3 70B Versatile per qualità)
- [sentence-transformers](https://www.sbert.net/) con il modello multilingua `intfloat/multilingual-e5-base` per gli embedding (~280 MB, CPU-only)
- [FAISS](https://github.com/facebookresearch/faiss) `IndexFlatIP` per la ricerca vettoriale (cosine similarity su vettori normalizzati)

---

## Struttura del repository

```
xr-turismo-llm/
├── backend/
│   ├── backend.py             # Server FastAPI con i tre endpoint AI
│   ├── rag.py                 # Modulo RAG: chunking, embedding, FAISS, retrieval MMR
│   ├── diagnostica_rag.py     # Script di analisi e debug dell'indice RAG
│   ├── corpus/                # Testi sorgente strutturati con marker Markdown
│   │   ├── Duomo_di_San_Ciriaco.txt
│   │   ├── Arco_di_Traiano.txt
│   │   ├── Mole_Vanvitelliana.txt
│   │   ├── Piazza_del_Plebiscito.txt
│   │   ├── Piazza_Cavour.txt
│   │   └── Il_Passetto.txt
│   ├── rag_index.faiss        # Indice FAISS (generato, escluso da git)
│   ├── rag_chunks.pkl         # Metadati chunk (generato, escluso da git)
│   ├── requirements.txt
│   └── .env                   # GROQ_API_KEY (escluso da git)
├── frontend/
│   ├── index.html
│   ├── public/
│   │   ├── tour.json          # Configurazione scene, hotspot e grafo di navigazione
│   │   ├── pic360/            # Panorami equirettangolari (Git LFS, ~30 MB ciascuno)
│   │   │   ├── Duomo1360.jpg … Duomo5360.jpg
│   │   │   ├── Arco0360.jpg … Arco7360.jpg
│   │   │   ├── Mole1360.jpg … Mole3360.jpg
│   │   │   ├── Pdp360.jpg … Pdp3360.jpg
│   │   │   ├── Smp1360.jpg, Smp2360.jpg
│   │   │   ├── Cavour360.jpg
│   │   │   └── Passetto360.jpg
│   │   ├── pic/               # Foto di dettaglio dei monumenti (per il pannello foto)
│   │   │   ├── duomo_leoni_stilofori.jpg
│   │   │   ├── plebiscito_statua_papa.jpg
│   │   │   └── ...
│   │   └── models/            # Modelli GLB degli hotspot informativi e di navigazione
│   │       ├── highpoly_info_sign_3d_icon.glb
│   │       └── map_pointer_3d_icon.glb
│   ├── src/
│   │   ├── main.js            # Rendering Three.js, gestione scene, hotspot e pannelli
│   │   └── style.css
│   └── package.json
├── ottimizza_foto_360.py      # Utility di pre-processing dei panorami 360°
└── README.md
```

> I panorami 360° sono tracciati con **Git LFS** (circa 20–30 file, ~30 MB l'uno). Assicurarsi che Git LFS sia installato prima del clone.

---

## Componenti principali

### Configurazione del tour (`tour.json`)

Il file `tour.json` è la sorgente di verità per l'intera struttura del tour. Ogni chiave di `scene` corrisponde a un sotto-panorama; il grafo di navigazione è codificato interamente negli hotspot.

**Schema di un sotto-panorama:**

```json
"Duomo1": {
  "nome": "Duomo di San Ciriaco - Sagrato",
  "panorama": "/pic360/Duomo1360.jpg",
  "luogo_id": "Duomo_di_San_Ciriaco",
  "rotazioneInizialeY": 0.8552,
  "hotspot": [
    {
      "id": "nav_Duomo1_to_Duomo2",
      "tipo": "nav_locale",
      "label": "Avvicinati al Portale",
      "destinazione": "Duomo2",
      "posizione": { "x": 2.8, "y": -3.8, "z": -9.6 },
      "rotazione": { "x": -1.43, "y": -0.29, "z": 0.34 },
      "yawArrivo": -2.5511
    },
    {
      "id": "info_Duomo1",
      "tipo": "info",
      "label": "Scopri il Duomo",
      "query": "Duomo_di_San_Ciriaco",
      "posizione": { "x": 10.1, "y": 7.4, "z": -4.9 },
      "secondari": [
        {
          "id": "info_leoni",
          "label": "I Leoni Stilofori",
          "query": "leoni stilofori portale Duomo di San Ciriaco Ancona",
          "posizione": { "x": 0.5, "y": 2.1, "z": -9.8 }
        }
      ]
    }
  ]
}
```

Campi principali:

| Campo | Tipo | Descrizione |
|---|---|---|
| `tipo` | string | `nav`, `nav_locale`, `info`, `info_secondario` |
| `destinazione` | string | ID della scena di arrivo (per `nav` e `nav_locale`) |
| `luogo_id` | string | Deve corrispondere al nome file corpus senza estensione |
| `query` | string | Testo inviato al backend; per `info` coincide con `luogo_id` |
| `rotazione` | object | Solo per `nav_locale`: orientamento del chevron (euler XYZ) |
| `yawArrivo` | number | Angolo Y (radianti) di inquadratura all'arrivo nella scena |
| `secondari` | array | Hotspot `info_secondario` annidati, espansi autonomamente dal frontend |

### Sistema RAG (`rag.py`)

Il corpus testuale è organizzato in un file `.txt` per monumento, strutturato con marker Markdown gerarchici (`##` sezioni, `###` sottosezioni, `####` sotto-sottosezioni), che corrispondono alla gerarchia delle voci Wikipedia di partenza.

**Chunking per sottosezione:** ogni `###` diventa un chunk autonomo, prefissato dal proprio titolo per arricchire l'embedding. Le `####` vengono inglobate nel chunk del padre `###`. Una `##` senza figli `###` diventa essa stessa un chunk. Il testo prima del primo header diventa il chunk "Introduzione". Il risultato è un corpus compatto (da file di oltre 9000 parole si ottengono ~33 chunk tematici per il Duomo) anziché frammenti generici di paragrafo.

**Pipeline di build:**

1. **Chunking** con `MIN_CHARS = 280` (soglia base) e `MIN_CHARS_SOTTOSEZ = 150` (soglia ridotta per sottosezioni titolate brevi ma legittime); `MAX_CHARS = 2600` oltre cui lo split avviene per paragrafo interno.
2. **Embedding** con `intfloat/multilingual-e5-base`, prefisso `passage:` su ogni chunk e `query:` sulla query.
3. **Indice FAISS** `IndexFlatIP` (prodotto interno su vettori normalizzati ≡ cosine similarity) con metadati salvati in pickle.

**Pipeline di retrieval a tre stadi:**

1. **FAISS** recupera i `k × FETCH_MULT` candidati per similarity grezza. I chunk spezzati (`is_spezzato = True`) ricevono un malus `−0.03` per evitare che frammenti "coda" senza intro tematica dominino il pivot iniziale.
2. **MMR** (Maximal Marginal Relevance, `λ = 0.7`) diversifica i candidati selezionando un pool di `k × POOL_MULT` chunk che bilancino rilevanza alla query e distanza tematica reciproca.
3. **Sampling temperato** (`temperature = 0.4`) sceglie i `k` chunk finali con probabilità proporzionale agli score normalizzati in [0,1] via softmax. Questo introduce varietà cross-chiamata: su chiamate ripetute allo stesso monumento, la guida riceve contesti parzialmente diversi e propone approfondimenti tematicamente variati.

**Parametri principali:**

| Parametro | Default | Rebuild? | Effetto |
|---|---|---|---|
| `MIN_CHARS` | 280 | sì | Lunghezza minima chunk generici |
| `MIN_CHARS_SOTTOSEZ` | 150 | sì | Lunghezza minima per sottosezioni titolate brevi |
| `MAX_CHARS` | 2600 | sì | Soglia oltre la quale la sottosezione viene spezzata per paragrafo |
| `MALUS_CHUNK_SPEZZATO` | 0.03 | no | Penalità di score per i frammenti `(N/M)` |
| `MMR_LAMBDA` | 0.7 | no | Bilancia rilevanza (1.0) vs diversità (0.0) nella selezione MMR |
| `POOL_MULT` | 4 | no | Pool MMR = `k × POOL_MULT`; valori più alti aumentano varietà |
| `TEMPERATURE_DEFAULT` | 0.4 | no | 0 = deterministico; 0.7+ = molto variato |

### Backend (`backend.py`)

Tre endpoint FastAPI, pensati per usi diversi e con diverso costo computazionale:

| Endpoint | Trigger | RAG | Modello | Output |
|---|---|---|---|---|
| `GET /spiegazione/{luogo}` | Click su hotspot `info` principale | sì (k=2) | Llama 3.1 8B / 3.3 70B | Descrizione + lista 3 approfondimenti |
| `GET /approfondimento/{argomento}` | Click su una scheda di approfondimento | sì (k=1) | Llama 3.1 8B / 3.3 70B | Descrizione ~100 parole + nome foto |
| `GET /info_rapida/{argomento}` | Click su hotspot `info_secondario` | no | Llama 3.1 8B | Descrizione breve ~80 parole |

`/approfondimento` riceve dal modello una risposta JSON `{"descrizione": ..., "immagine": ...}` (vincolata via `response_format`). Il campo `immagine` viene validato contro la lista hardcoded `FOTO_DISPONIBILI` in `backend.py`: se il modello genera un nome di file non esistente, il campo viene scartato e nessuna foto viene mostrata.

`/info_rapida` non usa RAG né few-shot: è circa 500 token di input più leggero per chiamata.

Tutti gli endpoint condividono lo stesso system prompt con la persona della guida: **"Marco, guida culturale italiana con 25 anni di esperienza"**, per uniformità di voce.

### Frontend (`main.js`)

Il file `main.js` gestisce tutto il rendering e l'interazione:

- **Scena Three.js**: una sfera con la texture panoramica renderizzata in `BackSide`, una camera prospettica al centro e `OrbitControls` limitati alla sola rotazione (pitch range bloccato per evitare il gimbal lock).
- **Hotspot 3D**: caricati da `tour.json` e istanziati come modelli GLB ricolorati (giallo per `info`, arancione per `info_secondario`, azzurro per `nav`). I `nav_locale` sono invece costruiti proceduralmente con `THREE.ShapeGeometry` come frecce chevron semi-trasparenti animate (pulsazione continua). Tutti gli hotspot hanno un anello luminoso a terra e un'etichetta sprite.
- **Pannello guida AI**: un piano 3D fisso nello spazio (non un overlay HTML), con il testo disegnato su un `<canvas>`. Le tre schede di approfondimento appaiono come tab cliccabili in 3D attorno al pannello principale.
- **Pannello foto**: un secondo piano 3D laterale con angoli arrotondati e cornice viola. Carica la foto restituita da `/approfondimento` con fade-in, adatta geometria e cornice all'aspect ratio reale dell'immagine, e usa il billboarding per guardare sempre la camera.
- **Hotspot secondari**: definiti nel `tour.json` come array `secondari` annidati dentro un hotspot `info` principale. Il frontend li espande automaticamente come hotspot autonomi al caricamento della scena, assegnando loro `tipo: info_secondario`.
- **Navigazione con yaw**: i `nav_locale` possono specificare un campo `yawArrivo` (angolo Y in radianti) che orienta automaticamente la camera nella direzione corretta all'arrivo nella nuova sotto-scena.

---

## Strumenti di sviluppo

Oltre al codice di runtime, il repository include due script Python standalone usati durante la fase di sviluppo. Non sono necessari per eseguire il tour ma sono parte integrante del flusso di lavoro che ha prodotto il progetto e sono utili per riprodurre o evolvere la base.

### `ottimizza_foto_360.py` — pre-processing dei panorami

Script di ottimizzazione delle foto equirettangolari 360°. Riduce la larghezza a un valore massimo configurabile (default 6000 px, soglia oltre la quale su WebGL non si guadagna nulla in qualità percepita) mantenendo il rapporto 2:1, e ricomprime in JPEG progressivo con subsampling 4:2:0. Salva le versioni ottimizzate in una sottocartella `ottimizzate/` accanto agli originali e mostra un report con il risparmio di spazio prima di proporre la sovrascrittura.

```bash
# Eseguire dalla root del progetto
python ottimizza_foto_360.py                              # anteprima con default
python ottimizza_foto_360.py --larghezza 4000 --qualita 85
python ottimizza_foto_360.py --sovrascrivi                # sostituisce gli originali
```

Dipendenze: `Pillow` (non incluso in `requirements.txt` del backend, va installato separatamente con `pip install Pillow`).

### `diagnostica_rag.py` — analisi dell'indice RAG

Strumento di introspezione dell'indice FAISS già costruito. Stampa una panoramica generale del corpus (numero di chunk per file, lunghezza media/min/max, distribuzione percentuale), un istogramma testuale delle lunghezze dei chunk per un singolo luogo, e il ranking dei chunk di quel luogo rispetto a una query, segnalando quali verrebbero effettivamente restituiti dal retriever con i parametri di `/spiegazione`.

```bash
cd backend
python diagnostica_rag.py                                       # panoramica tutti i file
python diagnostica_rag.py Duomo_di_San_Ciriaco                  # focus su un monumento
python diagnostica_rag.py Duomo_di_San_Ciriaco --query "leoni stilofori"
```

Usa direttamente le funzioni interne di `rag.py` (`_load_index`, `embed_query`) e ricostruisce i vettori dei chunk via `IndexFlatIP.reconstruct()` per calcolare la similarity riga per riga. È stato lo strumento principale per calibrare `MMR_LAMBDA`, `MIN_CHARS` e `TEMPERATURE_DEFAULT`.

---

## Requisiti

- Python ≥ 3.10
- Node.js ≥ 18
- [Git LFS](https://git-lfs.github.com/) (per i panorami 360°)
- Una chiave API [Groq](https://console.groq.com/) (il free tier è sufficiente)

### Dipendenze Python

Il `requirements.txt` contiene anche le dipendenze transitive. Le librerie direttamente usate sono:

- `fastapi`, `uvicorn` — framework web asincrono
- `groq` — client ufficiale per l'API Groq
- `python-dotenv` — caricamento variabili d'ambiente da `.env`
- `sentence-transformers` — modello di embedding multilingua (`intfloat/multilingual-e5-base`)
- `faiss-cpu` — indice vettoriale per la ricerca per similarità
- `numpy` — operazioni sui vettori di embedding
- `torch` — backend CPU di sentence-transformers

`Pillow` è una dipendenza dello script `ottimizza_foto_360.py` e non è inclusa in `requirements.txt`: va installata solo se si intende rieseguire l'ottimizzazione delle foto.

---

## Installazione e avvio

### 1. Clonare il repository

```bash
git lfs install
git clone https://github.com/LoreG002/xr-turismo-llm.git
cd xr-turismo-llm
```

> `git lfs install` è necessario solo la prima volta per abilitare Git LFS sul sistema. Se non eseguito prima del clone, i file `pic360/*.jpg` risulteranno puntatori testuali invece delle immagini reali.

### 2. Avviare il backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate            # su Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Creare un file `.env` nella cartella `backend/` con la chiave Groq:

```
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Quindi avviare il server:

```bash
python3 backend.py
```

Al primo avvio il modulo `rag.py` scarica il modello `multilingual-e5-base` da Hugging Face (~280 MB) e costruisce l'indice FAISS a partire dai file in `corpus/`, generando `rag_index.faiss` e `rag_chunks.pkl`. Le esecuzioni successive riusano l'indice già esistente. Il backend espone le API su `http://localhost:8000`.

### 3. Avviare il frontend

In un secondo terminale:

```bash
cd frontend
npm install
npm run dev
```

Vite serve il frontend su `http://localhost:5173`. Aprire quell'URL nel browser per iniziare il tour.

### 4. (Opzionale) WebXR / Visore VR

Per testare il tour in modalità immersiva senza un visore fisico, installare il [WebXR API Emulator](https://chrome.google.com/webstore/detail/webxr-api-emulator/mjddjgeghkdijejnciaefnkjmkafnnje) per Chrome. L'emulatore è compatibile esclusivamente con Three.js r172 (versioni r173+ rompono il polyfill).

---

## Note operative

### Aggiungere un nuovo monumento

1. Inserire un nuovo file `NomeMonumento.txt` in `backend/corpus/` con la stessa struttura Markdown (`##` sezioni, `###` sottosezioni). Eliminare `rag_index.faiss` e `rag_chunks.pkl` prima di riavviare il backend per forzare la rigenerazione dell'indice.
2. Aggiungere il o i panorami 360° in `frontend/public/pic360/` (preferibilmente passandoli attraverso `ottimizza_foto_360.py` per contenere il peso).
3. Aggiungere le scene corrispondenti in `tour.json`, valorizzando `luogo_id` con lo stesso nome del file corpus (senza estensione `.txt`).
4. Collegare il nuovo luogo al grafo aggiungendo hotspot `nav` reciproci in almeno un'altra scena.

### Calibrazione delle coordinate degli hotspot

`main.js` espone due strumenti di console per facilitare il posizionamento manuale degli hotspot in `tour.json`:

- **Doppio click in qualunque punto del panorama** stampa in console le coordinate `{ x, y, z }` del punto puntato sulla sfera, pronte da incollare nel campo `posizione` di un hotspot.
- **Tasto `R`** stampa l'angolo `rotazioneInizialeY` corrispondente alla direzione attualmente inquadrata dalla camera, da copiare nel campo omonimo di una scena (o nel `yawArrivo` di un hotspot di navigazione).

### Hot reload

Sia il backend (Uvicorn con `reload=True`) sia il frontend (Vite HMR) si aggiornano automaticamente al salvataggio dei file sorgente. Modifiche a `corpus/*.txt` o ai parametri di chunking in `rag.py` richiedono invece l'eliminazione manuale di `rag_index.faiss` e `rag_chunks.pkl` per forzare la rigenerazione dell'indice al successivo avvio.

### Debug del retrieval

Quando un approfondimento restituisce contenuto inaspettato o fuori tema, `diagnostica_rag.py` permette di ispezionare quali chunk hanno punteggio più alto rispetto a una data query e in quale ordine verrebbero selezionati dal retriever. È il primo strumento da usare prima di modificare i parametri RAG.

---

## Limiti e possibili sviluppi

- **Corpus limitato.** Solo 6 monumenti hanno un file di corpus e quindi accesso al retrieval RAG completo. Santa Maria della Piazza e gli altri soggetti secondari sono coperti solo tramite `/info_rapida`, che dipende esclusivamente dal training del modello.
- **Inferenza CPU-only.** Sia gli embedding sia il retrieval girano su CPU. Sul modello e5-base la latenza è accettabile (≲ 100 ms per chiamata), ma una build GPU di `faiss-gpu` e `sentence-transformers` accelererebbe la fase di build dell'indice e la query in scenari con corpus più grandi.
- **Nessuna sintesi vocale.** La guida è puramente testuale. Un'integrazione con un TTS multilingue (ad esempio Coqui XTTS o un servizio cloud) renderebbe il tour fruibile a mani libere in VR.
- **Mobile UX da rifinire.** Il tour è progettato per desktop e visore. Su mobile la navigazione touch e la dimensione del pannello guida AI necessitano di tuning specifico.
- **VR testata solo via emulatore.** Il rendering WebXR funziona, ma il test su hardware reale (Meta Quest, Pico) non è ancora stato fatto in modo sistematico.
- **Validazione delle foto via lista hardcoded.** Il match tra il nome file restituito dall'LLM e i file disponibili in `pic/` è gestito da una lista in `backend.py`. Per progetti più grandi conviene generare dinamicamente la whitelist dal filesystem e passarla al modello come parte del contesto.
