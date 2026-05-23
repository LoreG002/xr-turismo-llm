# XR Tour Ancona — Guida turistica immersiva con RAG e LLM

Tour virtuale a 360° dei principali monumenti di Ancona, arricchito da una guida culturale AI che genera descrizioni e approfondimenti in tempo reale a partire da fonti documentali, con immagini di dettaglio sincronizzate.

L'utente naviga tra panorami sferici cliccando hotspot 3D, e per ogni monumento può interrogare la guida AI per ottenere:
- una **descrizione narrativa** del luogo con relativi approfondimenti tematici,
- un **approfondimento** su ciascun aspetto, generato via RAG sul corpus testuale e accompagnato da una **foto di dettaglio** scelta automaticamente dal modello,
- **info rapide** su soggetti secondari della scena (statue, monumenti minori) senza retrieval, per risposte più leggere.

## Panoramica delle scene

Il tour comprende sei scene 360° collegate tra loro:

1. Duomo di San Ciriaco
2. Arco di Traiano
3. Mole Vanvitelliana
4. Piazza del Plebiscito (Piazza del Papa)
5. Piazza Cavour
6. Il Passetto

In ogni scena sono presenti hotspot di navigazione (per spostarsi tra panorami) e hotspot informativi di due tipi:
- **principali** (icona gialla): aprono il pannello guida AI con descrizione + tre schede di approfondimento, basate su RAG e accompagnate da una foto pertinente,
- **secondari** (icona arancione, più piccola): aprono il pannello guida con una descrizione breve di soggetti specifici della scena (es. la statua di Papa Clemente XII in Piazza del Plebiscito), senza retrieval né schede.

## Architettura

```
                       ┌─────────────────────────────────┐
                       │           FRONTEND              │
                       │   Three.js + Vite (porta 5173)  │
                       │                                 │
                       │  · Sfera panoramica 360°        │
                       │  · Hotspot 3D (GLB)             │
                       │  · Pannello guida AI in 3D      │
                       │  · Pannello foto laterale       │
                       └─────────────┬───────────────────┘
                                     │ HTTP (JSON)
                                     ▼
                       ┌─────────────────────────────────┐
                       │           BACKEND               │
                       │   FastAPI + Uvicorn (porta 8000)│
                       │                                 │
                       │  /spiegazione/{luogo}           │
                       │  /approfondimento/{argomento}   │
                       │  /info_rapida/{argomento}       │
                       └─────────┬───────────────┬───────┘
                                 │               │
                                 ▼               ▼
                       ┌─────────────────┐  ┌──────────┐
                       │     RAG         │  │  Groq    │
                       │ FAISS + e5-base │  │ Llama 3  │
                       │ corpus/*.txt    │  │  API     │
                       └─────────────────┘  └──────────┘
```

### Stack tecnologico

**Frontend**
- [Three.js](https://threejs.org/) per il rendering WebGL della scena 3D
- [Vite](https://vitejs.dev/) come dev server e bundler
- `GLTFLoader` per il caricamento dei modelli 3D degli hotspot

**Backend**
- [FastAPI](https://fastapi.tiangolo.com/) + [Uvicorn](https://www.uvicorn.org/) come web framework asincrono
- [Groq](https://groq.com/) come provider LLM (modello Llama 3.1 8B Instant)
- [sentence-transformers](https://www.sbert.net/) con il modello multilingua `intfloat/multilingual-e5-base` per gli embedding
- [FAISS](https://github.com/facebookresearch/faiss) per la ricerca vettoriale (cosine similarity)

## Struttura del repository

```
.
├── backend/
│   ├── backend.py            # Server FastAPI con i tre endpoint
│   ├── rag.py                # Modulo RAG: chunking, embedding, retrieval
│   ├── diagnostica_rag.py    # Script di analisi e debug dell'indice
│   ├── corpus/               # Testi sorgente strutturati con marker Markdown
│   │   ├── Duomo_di_San_Ciriaco.txt
│   │   ├── Arco_di_Traiano.txt
│   │   ├── Mole_Vanvitelliana.txt
│   │   ├── Piazza_del_Plebiscito.txt
│   │   ├── Piazza_Cavour.txt
│   │   └── Il_Passetto.txt
│   ├── rag_index.faiss       # Indice FAISS (generato da `python rag.py build`)
│   ├── rag_chunks.pkl        # Metadati chunk (generato da `python rag.py build`)
│   ├── requirements.txt
│   └── .env                  # GROQ_API_KEY
└── frontend/
    ├── index.html
    ├── public/
    │   ├── tour.json         # Configurazione scene e hotspot
    │   ├── *360.jpg          # Panorami equirettangolari
    │   ├── pic/              # Foto di dettaglio dei monumenti
    │   │   ├── duomo_leoni_stilofori.jpg
    │   │   ├── plebiscito_statua_papa.jpg
    │   │   └── ...
    │   └── models/           # Modelli GLB degli hotspot
    │       ├── highpoly_info_sign_3d_icon.glb
    │       └── map_pointer_3d_icon.glb
    ├── src/
    │   ├── main.js           # Logica Three.js, scene, hotspot, pannelli
    │   └── style.css
    └── package.json
```

## Componenti principali

### Sistema RAG (`rag.py`)

Il corpus testuale è organizzato in un file `.txt` per monumento. Ogni file è strutturato con marker Markdown a tre livelli — `##` sezioni, `###` sottosezioni, `####` sotto-sottosezioni — che corrispondono alla gerarchia delle voci Wikipedia di partenza.

Il chunking avviene **per sottosezione** (`###`), non per paragrafo. Ogni sottosezione diventa un chunk autonomo, prefissato dal proprio titolo per arricchire l'embedding. Le sotto-sottosezioni (`####`) vengono inglobate nel chunk della sottosezione padre, mantenendo la coerenza tematica. Se una sezione `##` non ha sottosezioni `###` figlie, diventa essa stessa un chunk. Il testo prima del primo header diventa il chunk "Introduzione".

Il risultato è un corpus compatto e tematicamente coerente: a fronte di file anche molto estesi (il Duomo di San Ciriaco supera 9000 parole), si ottengono chunk mirati su singoli aspetti del monumento (architettura, storia, arte, curiosità) anziché frammenti generici di paragrafo.

La pipeline di build in dettaglio:

1. **Chunking per sottosezione** con `MIN_CHARS = 280` per filtrare orfanelle e didascalie (soglia ridotta a 150 per sottosezioni titolate brevi ma legittime), e `MAX_CHARS = 2600` oltre il quale lo split avviene per paragrafo interno.
2. **Embedding** con `intfloat/multilingual-e5-base`, modello multilingua ottimizzato per il retrieval, con prefisso `passage:` su ogni chunk e `query:` sulla query.
3. **Indice FAISS** `IndexFlatIP` (prodotto interno su vettori normalizzati ≡ cosine similarity) con metadati salvati in pickle. Ogni chunk conserva titolo, sezione padre e flag `is_spezzato` per i frammenti da split.

Il retrieval usa una pipeline a tre stadi:

1. **FAISS** recupera i `k × FETCH_MULT` candidati per similarity grezzo. I chunk marcati come spezzati (`is_spezzato = True`) ricevono un malus di score (`-0.03`) per evitare che frammenti "coda" senza intro tematica dominino il pivot iniziale.
2. **MMR** (Maximal Marginal Relevance, `λ = 0.7`) diversifica i candidati selezionando un pool di `k × POOL_MULT` chunk che bilancino rilevanza alla query e distanza tematica reciproca.
3. **Sampling temperato** (`temperature = 0.4`) sceglie i `k` chunk finali dal pool MMR con probabilità proporzionale agli score normalizzati in [0,1] via softmax. Questo introduce varietà cross-chiamata: su chiamate ripetute allo stesso monumento, la guida AI riceve contesti parzialmente diversi e propone approfondimenti tematicamente variati a ogni clic.

Il modulo espone la funzione `retrieve(query, luogo_id, k, temperature)`, chiamata dal backend per recuperare il contesto prima di interrogare l'LLM.

### Backend (`backend.py`)

Tre endpoint, pensati per usi diversi e con diverso costo computazionale:

| Endpoint | Uso | RAG | Output |
|---|---|---|---|
| `GET /spiegazione/{luogo}` | Descrizione introduttiva al click su un hotspot principale | sì (k=2) | descrizione + lista di 3 approfondimenti |
| `GET /approfondimento/{argomento}` | Click su una scheda di approfondimento | sì (k=1) | descrizione ~100 parole + nome foto |
| `GET /info_rapida/{argomento}` | Hotspot secondari (statue, monumenti minori) | no | descrizione breve ~80 parole |

L'endpoint `/approfondimento` riceve dal modello una risposta JSON `{"descrizione": ..., "immagine": ...}` (vincolata via `response_format`), e il campo `immagine` viene validato contro una lista hardcoded `FOTO_DISPONIBILI`: se il modello inventa un nome di file non presente, il campo viene scartato e nessuna foto viene mostrata. Questo evita che il frontend tenti di caricare immagini inesistenti.

L'endpoint `/info_rapida` non usa RAG né few-shot e ha un prompt secco: è ~500 token di input più leggero per chiamata.

Il system prompt definisce la persona della guida ("Marco, guida culturale italiana con 25 anni di esperienza"), per uniformità di voce tra i tre endpoint.

### Frontend (`main.js`)

Il file `main.js` gestisce tutto il rendering e l'interazione:

- **Scena Three.js**: una sfera con il panorama in `BackSide` come texture, una camera prospettica al centro, controlli OrbitControls limitati alla rotazione.
- **Hotspot 3D**: caricati da `tour.json` e istanziati come modelli GLB ricolorati (giallo per gli info principali, arancione per i secondari, azzurro per la navigazione). Sono animati con un leggero galleggiamento verticale e un anello luminoso a terra.
- **Pannello guida AI**: un piano 3D fisso nello spazio (non un'UI HTML), con il testo disegnato su un canvas. Le schede di approfondimento appaiono come "tab" attorno al pannello principale, anch'esse cliccabili in 3D.
- **Pannello foto**: un secondo piano 3D, accanto al pannello testo, con angoli arrotondati e cornice viola coerente con quello principale. Carica la foto restituita da `/approfondimento` con fade-in, adattando geometria e cornice all'aspect ratio reale dell'immagine. Si riposiziona ogni frame per restare ancorato al pannello testo e usa il *billboarding* per guardare sempre la camera.
- **Hotspot secondari**: definiti nel `tour.json` come array `secondari` annidati dentro un hotspot principale. Il frontend li espande automaticamente come hotspot autonomi al caricamento della scena, assegnando loro `tipo: info_secondario`.

## Requisiti

- Python ≥ 3.10
- Node.js ≥ 18
- Una chiave API di [Groq](https://console.groq.com/) (free tier sufficiente)

### Dipendenze Python principali

Sono elencate qui le librerie effettivamente usate dal progetto. Il `requirements.txt` contiene anche dipendenze transitive: per installare tutto correttamente è sufficiente `pip install -r requirements.txt`.

- `fastapi`, `uvicorn` — server web
- `groq` — client per l'API Groq
- `python-dotenv` — caricamento `.env`
- `sentence-transformers` — modello di embedding multilingua
- `faiss-cpu` — indice vettoriale
- `numpy` — operazioni sui vettori
- `torch` — backend di sentence-transformers (CPU-only è sufficiente)

## Installazione e avvio

### 1. Clonare il repository

```bash
git clone <url-del-repo>
cd xr-turismo-llm
```

### 2. Backend

Crea un ambiente virtuale (consigliato) e installa le dipendenze:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate          # su macOS/Linux
# .\venv\Scripts\activate         # su Windows
pip install -r requirements.txt
```

Crea il file `backend/.env` con la tua chiave Groq:

```
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
```

**Costruisci l'indice RAG** (operazione da fare una sola volta, o ogni volta che modifichi i file in `corpus/`):

```bash
python rag.py build
```

Output atteso (la prima esecuzione scarica ~280 MB del modello di embedding):

```
[RAG] Trovati 6 file in corpus/
  - Duomo_di_San_Ciriaco: 33 chunk
  - Arco_di_Traiano: 9 chunk
  - Mole_Vanvitelliana: 20 chunk
  - Piazza_Cavour: 13 chunk
  - Piazza_del_Plebiscito: 10 chunk
  - Il_Passetto: 5 chunk
[RAG] Totale chunk: 90. Calcolo embeddings...
[RAG] Indice salvato in rag_index.faiss
[RAG] Pronto. 90 chunk indicizzati su 6 monumenti.
```

Puoi verificare che il retrieval funzioni con:

```bash
python rag.py test "leoni del Duomo di Ancona" --luogo Duomo_di_San_Ciriaco
```

Per un'analisi approfondita dell'indice (distribuzione chunk, ranking per query, istogramma lunghezze):

```bash
python diagnostica_rag.py                          # panoramica tutti i file
python diagnostica_rag.py Duomo_di_San_Ciriaco     # focus su un monumento
python diagnostica_rag.py Duomo_di_San_Ciriaco --query "leoni stilofori"
```

**Avvia il backend:**

```bash
python3 backend.py
```

Il server resta in ascolto su `http://localhost:8000`.

### 3. Frontend

In un secondo terminale:

```bash
cd frontend
npm install
npm run dev
```

Il dev server di Vite parte su `http://localhost:5173`. Aprilo nel browser e clicca sugli hotspot per navigare e interrogare la guida.

## Note operative

- I file `rag_index.faiss` e `rag_chunks.pkl` sono **rigenerabili** dal corpus e per questo sono esclusi dal versionamento (`.gitignore`).
- Anche `backend/venv/`, `backend/.cache/` e `backend/.env` sono esclusi.
- Per aggiungere nuove foto di dettaglio: caricale in `frontend/public/pic/` con nome lowercase e underscore (es. `duomo_cripta.jpg`), poi aggiungi il nome alla lista `FOTO_DISPONIBILI` in `backend.py`. Il modello LLM riceve la lista nel prompt e sceglie quella più pertinente per ogni approfondimento.
- Per aggiungere un nuovo hotspot secondario: annidalo come elemento di `secondari` dentro un hotspot principale nel `tour.json`, specificando `id`, `label`, `query` (testo descrittivo per il prompt) e `posizione`.

### Struttura dei file corpus

Ogni `.txt` in `corpus/` deve essere strutturato con marker Markdown gerarchici:

```
Testo introduttivo (diventa il chunk "Introduzione").

## Nome sezione (es. Storia)

Testo della sezione — se non ha ### figlie, diventa un chunk a sé.

### Nome sottosezione (es. Le origini medievali)

Testo della sottosezione. Questo è il livello che produce un chunk.

#### Nome sotto-sottosezione (es. Il restauro del XII secolo)

Testo inglobato nel chunk della sottosezione ### padre.
```

Il rebuild dell'indice è necessario ogni volta che si modificano i `.txt` o si aggiunge un nuovo file al corpus.

### Tuning dei parametri RAG

I parametri principali sono costanti all'inizio di `rag.py`. Quelli che influenzano il chunking richiedono un rebuild dell'indice; gli altri sono attivi a runtime:

| Parametro | Default | Rebuild? | Effetto |
|---|---|---|---|
| `MIN_CHARS` | 280 | sì | Lunghezza minima chunk generici; aumentare filtra più rumore |
| `MIN_CHARS_SOTTOSEZ` | 150 | sì | Lunghezza minima per sottosezioni titolate brevi |
| `MAX_CHARS` | 2600 | sì | Soglia oltre la quale la sottosezione viene spezzata per paragrafo |
| `MALUS_CHUNK_SPEZZATO` | 0.03 | no | Penalità di score per i frammenti `(N/M)` |
| `MMR_LAMBDA` | 0.7 | no | Bilancia rilevanza (1.0) vs diversità (0.0) nella selezione MMR |
| `POOL_MULT` | 4 | no | Ampiezza pool MMR = `k × POOL_MULT`; valori più alti aumentano varietà |
| `TEMPERATURE_DEFAULT` | 0.4 | no | 0 = deterministico, 0.4 = varietà controllata, 0.7+ = molto variato |

## Limiti e possibili sviluppi

- Le foto di dettaglio sono attualmente curate manualmente. Un'estensione naturale sarebbe l'integrazione con un image retrieval semantico (es. CLIP) per evitare la lista hardcoded.
- Il corpus testuale è limitato ai sei monumenti del tour. Un'estensione richiede l'aggiunta di nuovi `.txt` strutturati con marker `##`/`###` e la ricostruzione dell'indice.
- Il retrieval usa embedding densi (e5-base). Un'estensione possibile è un retrieval ibrido (BM25 + dense) per migliorare la precisione su query con termini tecnici specifici (nomi propri, date, materiali).
- Il progetto è pensato per esecuzione locale; un deploy pubblico richiederebbe protezione della chiave Groq lato server e configurazione CORS più restrittiva.

---

Progetto per il corso di **Computer Graphics & Multimedia** — AA 2025/26
Autori: Francesco Concetti, Lorenzo Giannetti, Jacopo Tarulli
