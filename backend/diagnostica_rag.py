"""
diagnostica_rag.py — Analizza l'attuale indice RAG.

Uso:
  python diagnostica_rag.py                # panoramica generale di tutti i file
  python diagnostica_rag.py Duomo          # focus su un luogo (prefisso del nome file)
  python diagnostica_rag.py Duomo --query "rito dei bambini leoni"

Cosa stampa:
  1. Per ogni file: numero chunk, lunghezza media/min/max, % sul corpus totale
  2. Distribuzione lunghezze chunk (istogramma testuale) per il file focus
  3. Ranking dei chunk del file focus per similarity verso la query
     (default: il luogo stesso, cioè la query che userebbe /spiegazione)
"""

import sys
from collections import defaultdict
from pathlib import Path

from rag import (
    _load_index,
    embed_query,
    _normalizza_luogo_id,
)


def stats_per_file(meta):
    """Aggrega numero e lunghezza chunk per luogo_id."""
    per_luogo = defaultdict(list)
    for c in meta:
        per_luogo[c["luogo_id"]].append(len(c["testo"]))
    return per_luogo


def stampa_panoramica(per_luogo):
    print("\n" + "=" * 78)
    print("PANORAMICA CORPUS")
    print("=" * 78)
    totale_chunk = sum(len(v) for v in per_luogo.values())
    totale_caratteri = sum(sum(v) for v in per_luogo.values())

    print(f"\nTotale file: {len(per_luogo)}")
    print(f"Totale chunk: {totale_chunk}")
    print(f"Totale caratteri: {totale_caratteri:,}\n")

    header = f"{'Luogo':<40} {'Chunk':>7} {'AvgLen':>8} {'Min':>5} {'Max':>5} {'% chunks':>10}"
    print(header)
    print("-" * 78)

    for luogo, lunghezze in sorted(per_luogo.items(), key=lambda kv: -len(kv[1])):
        n = len(lunghezze)
        avg = sum(lunghezze) // n
        mn = min(lunghezze)
        mx = max(lunghezze)
        perc = (n / totale_chunk) * 100
        nome = luogo if len(luogo) <= 38 else luogo[:35] + "..."
        print(f"{nome:<40} {n:>7} {avg:>8} {mn:>5} {mx:>5} {perc:>9.1f}%")
    print()


def istogramma_lunghezze(lunghezze, bin_size=100, max_bar=50):
    """Istogramma testuale delle lunghezze dei chunk."""
    if not lunghezze:
        return
    print("\n" + "=" * 78)
    print("DISTRIBUZIONE LUNGHEZZE CHUNK")
    print("=" * 78)
    mx = max(lunghezze)
    n_bin = (mx // bin_size) + 1
    bins = [0] * n_bin
    for l in lunghezze:
        bins[l // bin_size] += 1

    max_count = max(bins)
    for i, count in enumerate(bins):
        if count == 0:
            continue
        low = i * bin_size
        high = low + bin_size - 1
        bar_len = int((count / max_count) * max_bar)
        bar = "█" * bar_len
        print(f"  {low:>4}-{high:<4} chars  | {bar} {count}")
    print()


def ranking_per_query(meta, luogo_target, query, index):
    """
    Per ogni chunk del luogo_target, calcola la similarity verso `query`
    e li ordina dal più simile al meno simile.
    """
    print("\n" + "=" * 78)
    print(f"RANKING CHUNK DI '{luogo_target}'")
    print(f"per la query: '{query}'")
    print("=" * 78)

    chunk_idx_globali = [
        i for i, c in enumerate(meta) if c["luogo_id"] == luogo_target
    ]
    if not chunk_idx_globali:
        print(f"\n⚠ Nessun chunk per luogo '{luogo_target}'")
        return

    q_emb = embed_query(query)

    import numpy as np
    chunk_vecs = np.array([index.reconstruct(i) for i in chunk_idx_globali])

    scores = (chunk_vecs @ q_emb.T).flatten()

    coppie = sorted(zip(scores, chunk_idx_globali), key=lambda x: -x[0])

    print(f"\nChunk totali: {len(coppie)}\n")
    print(f"{'Rank':<5} {'Score':<7} {'Lunghezza':<10} {'Anteprima'}")
    print("-" * 78)
    for rank, (score, idx_glob) in enumerate(coppie, 1):
        chunk = meta[idx_glob]
        testo = chunk["testo"].replace("\n", " ")
        anteprima = testo[:80] + ("..." if len(testo) > 80 else "")
        marker = " ←" if rank <= 2 else "  " 
        print(f"{rank:<5} {score:<7.3f} {len(chunk['testo']):<10} {anteprima}{marker}")

    print()
    print("Legenda: ← = chunk che verrebbe restituito con k=2 (default di /spiegazione)")
    print()


def main():
    args = sys.argv[1:]
    focus = None
    query_custom = None

    if args:
        focus = args[0]
        if "--query" in args:
            q_idx = args.index("--query")
            if q_idx + 1 < len(args):
                query_custom = args[q_idx + 1]

    index, meta = _load_index()
    per_luogo = stats_per_file(meta)

    stampa_panoramica(per_luogo)

    if not focus:
        print("Per analizzare un luogo specifico:")
        print("  python diagnostica_rag.py <prefisso-nome-file>")
        print("  python diagnostica_rag.py Duomo --query 'rito dei bambini'")
        return

    luoghi_match = [l for l in per_luogo if l.lower().startswith(focus.lower())]
    if not luoghi_match:
        print(f"⚠ Nessun luogo che inizia con '{focus}'.")
        print(f"  Disponibili: {', '.join(sorted(per_luogo.keys()))}")
        return
    if len(luoghi_match) > 1:
        print(f"⚠ Più match per '{focus}': {luoghi_match}. Usa un prefisso più specifico.")
        return

    luogo_target = luoghi_match[0]
    lunghezze = per_luogo[luogo_target]
    istogramma_lunghezze(lunghezze)

    query = query_custom or luogo_target.replace("_", " ")
    ranking_per_query(meta, luogo_target, query, index)


if __name__ == "__main__":
    main()