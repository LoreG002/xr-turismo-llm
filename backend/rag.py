"""
rag.py — RAG leggero in-memory per la Guida AI di Ancona.

Uso:
  1) Costruisci l'indice una volta sola:
       python rag.py build
  2) Dal backend, importa e chiama:
       from rag import retrieve
       chunks = retrieve("Duomo di San Ciriaco", luogo_id="Duomo_di_San_Ciriaco_ad_Ancona", k=3)

Dipendenze:
  pip install sentence-transformers faiss-cpu numpy
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

# =====================================================
# CONFIG
# =====================================================
BASE_DIR = Path(__file__).parent
CORPUS_DIR = BASE_DIR / "corpus"
INDEX_PATH = BASE_DIR / "rag_index.faiss"
META_PATH = BASE_DIR / "rag_chunks.pkl"

# Modello multilingua forte sull'italiano, ~280MB, gira su CPU
EMBED_MODEL_NAME = "intfloat/multilingual-e5-base"

# Chunking: paragrafi Wikipedia. Se un paragrafo è > MAX_CHARS, lo spezziamo.
MIN_CHARS = 120     # paragrafi più corti li scarto (titoli di sezione, frasi orfane)
MAX_CHARS = 900     # ~200-250 token, dimensione ottimale per retrieval

# Cache singleton del modello e dell'indice (così non ricarichiamo a ogni chiamata)
_model = None
_index = None
_chunks_meta = None


# =====================================================
# CHUNKING
# =====================================================
def chunk_paragrafi(testo: str):
    """
    Spezza un testo Wikipedia in chunk per paragrafo.
    Paragrafi troppo lunghi vengono splittati su frasi.
    """
    # I .txt di Wikipedia hanno paragrafi separati da \n\n o \n singolo
    paragrafi = re.split(r'\n\s*\n', testo)
    chunks = []

    for p in paragrafi:
        p = p.strip()
        if len(p) < MIN_CHARS:
            continue

        if len(p) <= MAX_CHARS:
            chunks.append(p)
        else:
            # Paragrafo troppo lungo: spezza su frasi mantenendo coerenza
            frasi = re.split(r'(?<=[.!?])\s+', p)
            buffer = ""
            for f in frasi:
                if len(buffer) + len(f) + 1 <= MAX_CHARS:
                    buffer = (buffer + " " + f).strip()
                else:
                    if len(buffer) >= MIN_CHARS:
                        chunks.append(buffer)
                    buffer = f
            if len(buffer) >= MIN_CHARS:
                chunks.append(buffer)

    return chunks


# =====================================================
# MODELLO (lazy load)
# =====================================================
def get_model():
    global _model
    if _model is None:
        print(f"[RAG] Carico modello embeddings: {EMBED_MODEL_NAME}")
        _model = SentenceTransformer(EMBED_MODEL_NAME)
    return _model


def embed_passages(testi):
    """
    Embedding per i CHUNK del corpus.
    e5 richiede il prefisso 'passage: ' per i documenti indicizzati.
    """
    model = get_model()
    testi_prefixed = [f"passage: {t}" for t in testi]
    emb = model.encode(testi_prefixed, normalize_embeddings=True, show_progress_bar=True)
    return np.asarray(emb, dtype="float32")


def embed_query(query: str):
    """
    Embedding per la QUERY.
    e5 richiede il prefisso 'query: ' per le ricerche.
    """
    model = get_model()
    emb = model.encode([f"query: {query}"], normalize_embeddings=True)
    return np.asarray(emb, dtype="float32")


# =====================================================
# BUILD INDEX
# =====================================================
def build_index():
    """
    Legge tutti i .txt da corpus/, fa chunking, embeddi e salva su disco.
    Il nome del file (senza .txt) diventa il luogo_id del chunk.
    """
    if not CORPUS_DIR.exists():
        raise FileNotFoundError(
            f"Cartella corpus non trovata: {CORPUS_DIR}\n"
            f"Crea la cartella e mettici i .txt di Wikipedia."
        )

    files = sorted(glob.glob(str(CORPUS_DIR / "*.txt")))
    if not files:
        raise FileNotFoundError(f"Nessun .txt trovato in {CORPUS_DIR}")

    print(f"[RAG] Trovati {len(files)} file in {CORPUS_DIR}")

    all_chunks = []   # lista di stringhe
    all_meta = []     # parallela: dict {luogo_id, fonte, idx_locale}

    for path in files:
        nome_file = Path(path).stem  # es: "Duomo_di_San_Ciriaco_ad_Ancona"
        with open(path, "r", encoding="utf-8") as f:
            testo = f.read()

        chunks = chunk_paragrafi(testo)
        print(f"  - {nome_file}: {len(chunks)} chunk")

        for i, c in enumerate(chunks):
            all_chunks.append(c)
            all_meta.append({
                "luogo_id": nome_file,
                "fonte": Path(path).name,
                "idx": i,
                "testo": c,
            })

    if not all_chunks:
        raise RuntimeError("Nessun chunk estratto dai file. Controlla il contenuto dei .txt.")

    print(f"[RAG] Totale chunk: {len(all_chunks)}. Calcolo embeddings...")
    emb = embed_passages(all_chunks)

    # FAISS index con prodotto interno (gli embedding sono già normalizzati → equivale a cosine)
    dim = emb.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(emb)

    faiss.write_index(index, str(INDEX_PATH))
    with open(META_PATH, "wb") as f:
        pickle.dump(all_meta, f)

    print(f"[RAG] Indice salvato in {INDEX_PATH}")
    print(f"[RAG] Metadati salvati in {META_PATH}")
    print(f"[RAG] Pronto. {len(all_chunks)} chunk indicizzati su {len(files)} monumenti.")


# =====================================================
# RETRIEVE (runtime)
# =====================================================
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
    """
    Normalizza un luogo_id per match con i nomi file.
    Il tour.json può avere 'Duomo di San Ciriaco ad Ancona' (con spazi),
    i file sono 'Duomo_di_San_Ciriaco_ad_Ancona.txt'.
    """
    return s.strip().replace(" ", "_")


def retrieve(query: str, luogo_id: str = None, k: int = 3, score_min: float = 0.55):
    """
    Recupera i top-k chunk più rilevanti per la query.

    Args:
        query: testo della ricerca (es. "Duomo di San Ciriaco facciata")
        luogo_id: se fornito, filtra SOLO i chunk di quel monumento (consigliato per /spiegazione)
        k: numero di chunk da restituire
        score_min: soglia minima di similarità (0-1). Sotto questa, scarta il chunk.

    Returns:
        Lista di dict {testo, luogo_id, fonte, score}. Vuota se niente di rilevante.
    """
    index, meta = _load_index()

    q_emb = embed_query(query)

    # Se è specificato un luogo_id, prendiamo più candidati e filtriamo dopo
    # (FAISS IndexFlat non supporta filtri pre-search; per un corpus piccolo va benissimo)
    n_search = k * 10 if luogo_id else k

    scores, idxs = index.search(q_emb, min(n_search, len(meta)))

    risultati = []
    luogo_target = _normalizza_luogo_id(luogo_id) if luogo_id else None

    for score, idx in zip(scores[0], idxs[0]):
        if idx < 0:
            continue
        chunk = meta[idx]
        if luogo_target and chunk["luogo_id"] != luogo_target:
            continue
        if float(score) < score_min:
            continue
        risultati.append({
            "testo": chunk["testo"],
            "luogo_id": chunk["luogo_id"],
            "fonte": chunk["fonte"],
            "score": float(score),
        })
        if len(risultati) >= k:
            break

    return risultati


def format_contesto_per_prompt(chunks):
    """
    Formatta i chunk recuperati come blocco da iniettare nel prompt.
    Restituisce stringa vuota se nessun chunk (così il prompt resta pulito).
    """
    if not chunks:
        return ""

    blocchi = []
    for i, c in enumerate(chunks, 1):
        blocchi.append(f"[Estratto {i} — da {c['fonte']}]\n{c['testo']}")

    return (
        "FONTI VERIFICATE (da Wikipedia):\n"
        "===\n"
        + "\n---\n".join(blocchi)
        + "\n===\n"
        "Usa questi estratti come fondamento dei tuoi fatti (date, nomi, materiali, dimensioni).\n"
        "Puoi arricchire con dettagli sensoriali e narrativi nello stile di Marco,\n"
        "ma NON contraddire i fatti negli estratti e NON inventare dati verificabili che non siano lì."
    )


# =====================================================
# CLI
# =====================================================
if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2 or sys.argv[1] not in ("build", "test"):
        print("Uso:")
        print("  python rag.py build          # costruisce l'indice")
        print("  python rag.py test <query>   # testa il retrieval")
        sys.exit(1)

    if sys.argv[1] == "build":
        build_index()
    elif sys.argv[1] == "test":
        if len(sys.argv) < 3:
            print("Manca la query. Es: python rag.py test 'leoni del Duomo'")
            sys.exit(1)
        query = " ".join(sys.argv[2:])
        risultati = retrieve(query, k=3)
        print(f"\n=== Risultati per: '{query}' ===\n")
        for r in risultati:
            print(f"[{r['score']:.3f}] {r['luogo_id']}")
            print(r["testo"][:300] + "...")
            print()