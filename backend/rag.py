"""
rag.py — RAG leggero in-memory per la Guida AI di Ancona.

CHUNKING per sottosezione Markdown:
  - Ogni "### Sottosezione" diventa un chunk dedicato (tematicamente coerente).
  - Le "#### Sottosottosezioni" vengono INGLOBATE nel chunk del loro padre ###.
  - Una "## Sezione" senza sottosezioni ### diventa essa stessa un chunk.
  - Il testo prima del primo ## diventa il chunk "Introduzione".
  - Ogni chunk è prefissato dal proprio titolo per arricchire l'embedding.

RETRIEVAL con MMR (Maximal Marginal Relevance):
  - Top-N candidati per similarity, poi selezione iterativa che bilancia
    rilevanza alla query e diversità rispetto ai chunk già scelti.

Uso:
  1) Costruisci l'indice:
       python rag.py build
  2) Dal backend:
       from rag import retrieve
       chunks = retrieve("query", luogo_id="Duomo_di_San_Ciriaco", k=3)
  3) Test CLI:
       python rag.py test "leoni stilofori"
"""

import os
import re
import json
import glob
import pickle
from pathlib import Path

import numpy as np
import faiss
from sentence_transformers import SentenceTransformer

BASE_DIR = Path(__file__).parent
CORPUS_DIR = BASE_DIR / "corpus"
INDEX_PATH = BASE_DIR / "rag_index.faiss"
META_PATH = BASE_DIR / "rag_chunks.pkl"

EMBED_MODEL_NAME = "intfloat/multilingual-e5-base"

MIN_CHARS = 280            
MIN_CHARS_SOTTOSEZ = 150                         
MAX_CHARS = 2600           

MALUS_CHUNK_SPEZZATO = 0.03

MMR_LAMBDA = 0.7    
MMR_FETCH_MULT = 5  

TEMPERATURE_DEFAULT = 0.4
POOL_MULT = 4       

_model = None
_index = None
_chunks_meta = None

_HEADER_RE = re.compile(r'^(#{2,4})\s+(.+?)\s*$', re.MULTILINE)

def _parse_struttura(testo: str):
    """
    Scorre il testo e restituisce una lista ordinata di "blocchi":
      [{'livello': 2|3|4|0, 'titolo': str, 'corpo': str}, ...]
    Livello 0 = preambolo prima del primo header.
    Il corpo NON include il titolo.
    """
    matches = list(_HEADER_RE.finditer(testo))
    blocchi = []

    primo_inizio = matches[0].start() if matches else len(testo)
    preambolo = testo[:primo_inizio].strip()
    if preambolo:
        blocchi.append({'livello': 0, 'titolo': 'Introduzione', 'corpo': preambolo})


    for i, m in enumerate(matches):
        livello = len(m.group(1))
        titolo = m.group(2).strip()
        inizio_corpo = m.end()
        fine_corpo = matches[i + 1].start() if (i + 1) < len(matches) else len(testo)
        corpo = testo[inizio_corpo:fine_corpo].strip()
        blocchi.append({'livello': livello, 'titolo': titolo, 'corpo': corpo})

    return blocchi


def _split_paragrafi_lunghi(testo: str, max_chars: int):
    """
    Se 'testo' supera max_chars, lo spezza in pezzi rispettando i paragrafi.
    Restituisce sempre una lista (anche con un solo elemento se non serve splittare).
    """
    if len(testo) <= max_chars:
        return [testo]

    paragrafi = re.split(r'\n\s*\n', testo)
    pezzi = []
    buffer = ""
    for p in paragrafi:
        p = p.strip()
        if not p:
            continue
        if buffer and len(buffer) + len(p) + 2 > max_chars:
            pezzi.append(buffer)
            buffer = p
        else:
            buffer = (buffer + "\n\n" + p).strip() if buffer else p
    if buffer:
        pezzi.append(buffer)
    return pezzi


def chunk_per_sottosezione(testo: str, luogo_id: str):
    """
    Strategia:
      1. Parsa la struttura ##/###/####.
      2. Itera in ordine. Quando incontra:
         - una ### → apre nuovo chunk con quel titolo (sezione padre = ultima ## vista)
         - una #### → ne aggrega il contenuto al chunk ### corrente
         - una ## senza ### successive prima della prossima ## → diventa chunk a sé
         - preambolo (livello 0) → chunk "Introduzione"
      3. Se un chunk supera MAX_CHARS, lo spezza per paragrafo.
      4. Scarta chunk sotto MIN_CHARS.

    Restituisce: lista di dict {testo, titolo, sezione_padre, livello}.
    """
    blocchi = _parse_struttura(testo)
    chunks = []

    sezione_padre_corrente = None  
    chunk_corrente = None           

    def flush(c):
        """Chiude un chunk in costruzione: lo prefissa col titolo, lo splitta se troppo lungo,
        applica MIN_CHARS, e lo append ai risultati."""
        if not c:
            return
        contenuto = c['corpo'].strip()
        if not contenuto:
            return
        testo_chunk = f"{c['titolo']}\n\n{contenuto}"
        pezzi = _split_paragrafi_lunghi(testo_chunk, MAX_CHARS)

        soglia = MIN_CHARS_SOTTOSEZ if c['livello'] == 3 else MIN_CHARS
        for i, pezzo in enumerate(pezzi):
            if len(pezzo) < soglia:
                continue
            titolo_finale = c['titolo']
            if len(pezzi) > 1:
                titolo_finale = f"{c['titolo']} ({i + 1}/{len(pezzi)})"
            chunks.append({
                'testo': pezzo,
                'titolo': titolo_finale,
                'sezione_padre': c['sezione_padre'],
                'livello': c['livello'],
                'is_spezzato': len(pezzi) > 1,
            })

    for i, b in enumerate(blocchi):
        liv = b['livello']
        titolo = b['titolo']
        corpo = b['corpo']

        if liv == 0:
            flush({
                'titolo': titolo,
                'corpo': corpo,
                'sezione_padre': None,
                'livello': 0,
            })
            chunk_corrente = None
            continue

        if liv == 2:
            flush(chunk_corrente)
            chunk_corrente = None
            sezione_padre_corrente = titolo

            ha_figlie_terzo_livello = False
            for j in range(i + 1, len(blocchi)):
                if blocchi[j]['livello'] == 2:
                    break
                if blocchi[j]['livello'] == 3:
                    ha_figlie_terzo_livello = True
                    break

            if not ha_figlie_terzo_livello:
                corpo_esteso = corpo
                for j in range(i + 1, len(blocchi)):
                    if blocchi[j]['livello'] == 2:
                        break
                    if blocchi[j]['livello'] == 4:
                        corpo_esteso += f"\n\n{blocchi[j]['titolo']}\n\n{blocchi[j]['corpo']}"
                flush({
                    'titolo': titolo,
                    'corpo': corpo_esteso,
                    'sezione_padre': None, 
                    'livello': 2,
                })


        elif liv == 3:
            flush(chunk_corrente)

            chunk_corrente = {
                'titolo': titolo,
                'corpo': corpo,
                'sezione_padre': sezione_padre_corrente,
                'livello': 3,
            }

        elif liv == 4:
            if chunk_corrente is not None and chunk_corrente['livello'] == 3:
                chunk_corrente['corpo'] += f"\n\n{titolo}\n\n{corpo}"

    flush(chunk_corrente)

    return chunks

#Modello
def get_model():
    global _model
    if _model is None:
        print(f"[RAG] Carico modello embeddings: {EMBED_MODEL_NAME}")
        _model = SentenceTransformer(EMBED_MODEL_NAME)
    return _model


def embed_passages(testi):
    model = get_model()
    testi_prefixed = [f"passage: {t}" for t in testi]
    emb = model.encode(testi_prefixed, normalize_embeddings=True, show_progress_bar=True)
    return np.asarray(emb, dtype="float32")


def embed_query(query: str):
    model = get_model()
    emb = model.encode([f"query: {query}"], normalize_embeddings=True)
    return np.asarray(emb, dtype="float32")


def build_index():
    if not CORPUS_DIR.exists():
        raise FileNotFoundError(
            f"Cartella corpus non trovata: {CORPUS_DIR}\n"
            f"Crea la cartella e mettici i .txt di Wikipedia."
        )

    files = sorted(glob.glob(str(CORPUS_DIR / "*.txt")))
    if not files:
        raise FileNotFoundError(f"Nessun .txt trovato in {CORPUS_DIR}")

    print(f"[RAG] Trovati {len(files)} file in {CORPUS_DIR}")

    all_chunks = []  
    all_meta = []     

    for path in files:
        nome_file = Path(path).stem  
        with open(path, "r", encoding="utf-8") as f:
            testo = f.read()

        chunks = chunk_per_sottosezione(testo, luogo_id=nome_file)
        print(f"  - {nome_file}: {len(chunks)} chunk")

        for i, c in enumerate(chunks):
            all_chunks.append(c['testo'])
            all_meta.append({
                "luogo_id": nome_file,
                "fonte": Path(path).name,
                "idx": i,
                "testo": c['testo'],
                "titolo": c['titolo'],
                "sezione_padre": c['sezione_padre'],
                "livello": c['livello'],
                "is_spezzato": c.get('is_spezzato', False),
            })

    if not all_chunks:
        raise RuntimeError("Nessun chunk estratto. Controlla i .txt e i marker ##/###.")

    print(f"[RAG] Totale chunk: {len(all_chunks)}. Calcolo embeddings...")
    emb = embed_passages(all_chunks)

    dim = emb.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(emb)

    faiss.write_index(index, str(INDEX_PATH))
    with open(META_PATH, "wb") as f:
        pickle.dump(all_meta, f)

    print(f"[RAG] Indice salvato in {INDEX_PATH}")
    print(f"[RAG] Metadati salvati in {META_PATH}")
    print(f"[RAG] Pronto. {len(all_chunks)} chunk indicizzati su {len(files)} monumenti.")

def _load_index():
    """Carica indice e metadati in memoria (singleton)."""
    global _index, _chunks_meta
    if _index is None:
        if not INDEX_PATH.exists() or not META_PATH.exists():
            raise FileNotFoundError(
                f"Indice non trovato. Esegui prima: python rag.py build"
            )
        print(f"[RAG] Carico indice da {INDEX_PATH}")
        _index = faiss.read_index(str(INDEX_PATH))
        with open(META_PATH, "rb") as f:
            _chunks_meta = pickle.load(f)
        print(f"[RAG] Indice caricato: {len(_chunks_meta)} chunk")
    return _index, _chunks_meta


def _normalizza_luogo_id(s: str) -> str:
    """Converti 'Duomo di San Ciriaco' in 'Duomo_di_San_Ciriaco' per il match."""
    return s.strip().replace(" ", "_")


def _mmr_select(query_vec, cand_vecs, cand_indices, k, lam, sim_query_override=None):
    """
    Maximal Marginal Relevance.
      query_vec : (1, d) normalizzato
      cand_vecs : (N, d) normalizzati
      cand_indices : lista lunga N degli indici globali dei candidati
      k : quanti selezionare
      lam : 0..1 (1 = solo similarity, 0 = solo diversity)
      sim_query_override : se fornito (lista lunga N), sostituisce la similarity
                           query-candidato calcolata. Serve ad applicare malus.
    Restituisce: lista di indici globali selezionati IN ORDINE MMR.
    """
    if len(cand_indices) == 0:
        return []

    if sim_query_override is not None:
        sim_query = np.asarray(sim_query_override, dtype="float32")
    else:
        sim_query = (cand_vecs @ query_vec.T).flatten()

    sim_cand = cand_vecs @ cand_vecs.T

    selezionati_local = [] 
    rimanenti = set(range(len(cand_indices)))

    primo = int(np.argmax(sim_query))
    selezionati_local.append(primo)
    rimanenti.discard(primo)

    while len(selezionati_local) < k and rimanenti:
        best_score = -1e9
        best_idx = None
        for j in rimanenti:
            max_sim_sel = max(sim_cand[j, s] for s in selezionati_local)
            mmr_score = lam * sim_query[j] - (1 - lam) * max_sim_sel
            if mmr_score > best_score:
                best_score = mmr_score
                best_idx = j
        if best_idx is None:
            break
        selezionati_local.append(best_idx)
        rimanenti.discard(best_idx)

    return [cand_indices[i] for i in selezionati_local]


def _sample_temperatura(indici, scores, k, temperature):
    """
    Sampling pesato da una lista di candidati, usando softmax con temperatura
    sugli score NORMALIZZATI in [0,1]. Senza ripetizione.

    Args:
        indici: lista di N indici globali (già diversificati da MMR)
        scores: lista di N score (similarity vs query, già col malus applicato)
        k: quanti chunk pescare
        temperature: 0 = deterministico (prendi i primi k in ordine).
                     0.2-0.4 = chunk forti dominano, lieve varietà.
                     0.5-0.7 = varietà marcata.
                     >1 = quasi uniforme.

    Returns:
        Lista di k indici globali.
    """
    n = len(indici)
    if n == 0:
        return []
    if k >= n or temperature <= 0:
        return list(indici[:k])

    scores_arr = np.asarray(scores, dtype="float32")
    s_min, s_max = float(scores_arr.min()), float(scores_arr.max())
    if s_max - s_min < 1e-6:
        probs = np.ones(n, dtype="float32") / n
    else:
        scores_norm = (scores_arr - s_min) / (s_max - s_min) 
        logits = scores_norm / max(temperature, 1e-6)
        logits = logits - np.max(logits)  
        probs = np.exp(logits)
        probs = probs / np.sum(probs)

    pos_selezionate = np.random.choice(n, size=k, replace=False, p=probs)
    return [indici[int(i)] for i in pos_selezionate]


def retrieve(query: str,
             luogo_id: str = None,
             k: int = 3,
             score_min: float = 0.55,
             mmr_lambda: float = MMR_LAMBDA,
             fetch_mult: int = MMR_FETCH_MULT,
             temperature: float = TEMPERATURE_DEFAULT):
    """
    Recupera top-k chunk con diversificazione MMR e sampling temperato.

    Pipeline:
        1. FAISS pesca i candidati più simili alla query (con malus chunk spezzati).
        2. MMR seleziona un POOL di k * POOL_MULT candidati diversificati.
        3. Sampling con softmax+temperatura sceglie i k finali dal pool.

    Con temperature=0 → comportamento deterministico (top-k MMR).
    Con temperature>0 → varietà a chiamate ripetute, senza perdere coerenza.

    Args:
        query: testo della ricerca
        luogo_id: filtra SOLO i chunk di quel monumento (consigliato per /spiegazione)
        k: numero di chunk finali
        score_min: soglia minima di similarity sui candidati
        mmr_lambda: 0..1, bilancia rilevanza (1) vs diversità (0). Default 0.7.
        fetch_mult: candidati FAISS = k * fetch_mult
        temperature: 0 deterministico, 0.3-0.7 varietà controllata, >1 molto random.

    Returns:
        lista di dict {testo, luogo_id, fonte, titolo, sezione_padre, score, livello}
    """
    index, meta = _load_index()

    q_emb = embed_query(query)

    luogo_target = _normalizza_luogo_id(luogo_id) if luogo_id else None


    n_search = k * fetch_mult
    if luogo_target:
        n_search *= 4
    n_search = min(n_search, len(meta))

    scores, idxs = index.search(q_emb, n_search)

    cand_indices = []
    cand_scores = []
    for score, idx in zip(scores[0], idxs[0]):
        if idx < 0:
            continue
        chunk = meta[idx]
        if luogo_target and chunk["luogo_id"] != luogo_target:
            continue
        score_aggiustato = float(score)
        if chunk.get("is_spezzato"):
            score_aggiustato -= MALUS_CHUNK_SPEZZATO
        if score_aggiustato < score_min:
            continue
        cand_indices.append(int(idx))
        cand_scores.append(score_aggiustato)

    if cand_indices:
        ordine = sorted(range(len(cand_indices)), key=lambda i: -cand_scores[i])
        cand_indices = [cand_indices[i] for i in ordine]
        cand_scores = [cand_scores[i] for i in ordine]

    if not cand_indices:
        return []

    cand_vecs = np.array([index.reconstruct(i) for i in cand_indices], dtype="float32")

    if len(cand_indices) > 30:
        cand_indices = cand_indices[:30]
        cand_vecs = cand_vecs[:30]
        cand_scores = cand_scores[:30]

    pool_size = max(k, min(k * POOL_MULT, len(cand_indices)))
    mmr_pool = _mmr_select(
        query_vec=q_emb,
        cand_vecs=cand_vecs,
        cand_indices=cand_indices,
        k=pool_size,
        lam=mmr_lambda,
        sim_query_override=cand_scores,
    )

    idx_to_score = dict(zip(cand_indices, cand_scores))
    pool_scores = [idx_to_score.get(g, 0.0) for g in mmr_pool]
    selected_global = _sample_temperatura(
        indici=mmr_pool,
        scores=pool_scores,
        k=k,
        temperature=temperature,
    )

    risultati = []
    for g in selected_global:
        chunk = meta[g]
        risultati.append({
            "testo": chunk["testo"],
            "luogo_id": chunk["luogo_id"],
            "fonte": chunk["fonte"],
            "titolo": chunk.get("titolo"),
            "sezione_padre": chunk.get("sezione_padre"),
            "livello": chunk.get("livello"),
            "score": idx_to_score.get(g, 0.0),
        })
    return risultati


def format_contesto_per_prompt(chunks):
    """
    Formatta i chunk recuperati come blocco da iniettare nel prompt.
    Restituisce stringa vuota se nessun chunk.
    """
    if not chunks:
        return ""

    blocchi = []
    for i, c in enumerate(chunks, 1):
        titolo = c.get("titolo") or "—"
        sezione = c.get("sezione_padre")
        intestazione = f"[Estratto {i} — {titolo}"
        if sezione and sezione != titolo:
            intestazione += f" (sez. {sezione})"
        intestazione += f" — da {c['fonte']}]"
        blocchi.append(f"{intestazione}\n{c['testo']}")

    return (
        "FONTI VERIFICATE (da Wikipedia):\n"
        "===\n"
        + "\n---\n".join(blocchi)
        + "\n===\n"
        "Usa questi estratti come fondamento dei tuoi fatti (date, nomi, materiali, dimensioni).\n"
        "Puoi arricchire con dettagli sensoriali e narrativi nello stile di Marco,\n"
        "ma NON contraddire i fatti negli estratti e NON inventare dati verificabili che non siano lì."
    )

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2 or sys.argv[1] not in ("build", "test"):
        print("Uso:")
        print("  python rag.py build                # costruisce l'indice")
        print("  python rag.py test <query>         # testa il retrieval (con MMR)")
        print("  python rag.py test <query> --luogo <luogo_id>")
        sys.exit(1)

    if sys.argv[1] == "build":
        build_index()
    elif sys.argv[1] == "test":
        if len(sys.argv) < 3:
            print("Manca la query. Es: python rag.py test 'leoni del Duomo'")
            sys.exit(1)
        argv = sys.argv[2:]
        luogo = None
        if "--luogo" in argv:
            idx = argv.index("--luogo")
            if idx + 1 < len(argv):
                luogo = argv[idx + 1]
                argv = argv[:idx] + argv[idx + 2:]
        query = " ".join(argv)
        risultati = retrieve(query, luogo_id=luogo, k=3)
        print(f"\n=== Risultati per: '{query}' (luogo={luogo}) ===\n")
        for r in risultati:
            sez = r.get("sezione_padre")
            sez_str = f" [sez. {sez}]" if sez else ""
            print(f"[{r['score']:.3f}] {r['luogo_id']} — {r['titolo']}{sez_str}")
            print(r["testo"][:300].replace("\n", " ") + "...")
            print()