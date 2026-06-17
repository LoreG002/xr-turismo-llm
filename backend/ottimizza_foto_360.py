
"""
Ottimizza le foto 360 (equirettangolari) in frontend/public/pic360.
- Ridimensiona a max 6000px di larghezza mantenendo il rapporto 2:1
- Salva in una cartella 'ottimizzate/' accanto agli originali
- Mostra un report con risparmio di spazio prima di sovrascrivere

Dipendenza: pip install Pillow
Uso:        python ottimizza_foto_360.py
            python ottimizza_foto_360.py --larghezza 4000 --qualita 85 --sovrascrivi
"""

import argparse
import shutil
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("❌  Pillow non trovato. Installa con:  pip install Pillow")
    sys.exit(1)


CARTELLA_INPUT   = Path("frontend/public/pic360")
CARTELLA_OUTPUT  = CARTELLA_INPUT / "ottimizzate"
LARGHEZZA_MAX    = 6000  
QUALITA_JPEG     = 85    
ESTENSIONI       = {".jpg", ".jpeg", ".png", ".webp"}



def formatta_bytes(n: int) -> str:
    """Formatta i byte in KB / MB leggibili."""
    if n < 1024:
        return f"{n} B"
    elif n < 1024 ** 2:
        return f"{n / 1024:.1f} KB"
    else:
        return f"{n / 1024 ** 2:.1f} MB"


def ottimizza_immagine(
    percorso_in: Path,
    percorso_out: Path,
    larghezza_max: int,
    qualita: int,
) -> tuple[int, int, tuple[int, int], tuple[int, int]]:
    """
    Ottimizza una singola immagine.
    Restituisce (peso_originale, peso_output, dim_originale, dim_output).
    """
    with Image.open(percorso_in) as img:
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")

        dim_originale = img.size 

        if img.width > larghezza_max:
            rapporto = larghezza_max / img.width
            nuova_h  = int(img.height * rapporto)
            img = img.resize((larghezza_max, nuova_h), Image.LANCZOS)

        dim_output = img.size

        percorso_out.parent.mkdir(parents=True, exist_ok=True)
        img.save(
            percorso_out,
            "JPEG",
            quality=qualita,
            optimize=True,
            progressive=True, 
            subsampling=2,      
        )

    peso_orig = percorso_in.stat().st_size
    peso_out  = percorso_out.stat().st_size
    return peso_orig, peso_out, dim_originale, dim_output


def main():
    parser = argparse.ArgumentParser(
        description="Ottimizza foto 360 equirettangolari per il tour XR"
    )
    parser.add_argument(
        "--cartella",
        type=Path,
        default=CARTELLA_INPUT,
        help=f"Cartella con le foto originali (default: {CARTELLA_INPUT})",
    )
    parser.add_argument(
        "--larghezza",
        type=int,
        default=LARGHEZZA_MAX,
        help=f"Larghezza massima in pixel (default: {LARGHEZZA_MAX})",
    )
    parser.add_argument(
        "--qualita",
        type=int,
        default=QUALITA_JPEG,
        choices=range(60, 96),
        metavar="[60-95]",
        help=f"Qualità JPEG (default: {QUALITA_JPEG})",
    )
    parser.add_argument(
        "--sovrascrivi",
        action="store_true",
        help="Dopo l'anteprima, sovrascrive gli originali con le versioni ottimizzate",
    )
    args = parser.parse_args()

    cartella = args.cartella
    if not cartella.exists():
        print(f"❌  Cartella non trovata: {cartella}")
        print(f"    Assicurati di eseguire lo script dalla root del progetto.")
        sys.exit(1)

    foto = sorted(
        f for f in cartella.iterdir()
        if f.is_file() and f.suffix.lower() in ESTENSIONI
    )

    if not foto:
        print(f"⚠️   Nessuna immagine trovata in '{cartella}'")
        sys.exit(0)

    cartella_out = cartella / "ottimizzate"
    print(f"\n{'─' * 60}")
    print(f"  Foto trovate  : {len(foto)}")
    print(f"  Larghezza max : {args.larghezza} px")
    print(f"  Qualità JPEG  : {args.qualita}")
    print(f"  Output        : {cartella_out}/")
    print(f"{'─' * 60}\n")

    totale_orig  = 0
    totale_out   = 0
    risultati    = []

    for i, foto_path in enumerate(foto, 1):
        out_path = cartella_out / (foto_path.stem + ".jpg")
        print(f"[{i:02d}/{len(foto)}] {foto_path.name} ... ", end="", flush=True)

        try:
            peso_orig, peso_out, dim_orig, dim_new = ottimizza_immagine(
                foto_path, out_path, args.larghezza, args.qualita
            )
            risparmio_pct = (1 - peso_out / peso_orig) * 100 if peso_orig > 0 else 0
            ridimensionata = dim_orig != dim_new

            print(
                f"{formatta_bytes(peso_orig)} → {formatta_bytes(peso_out)} "
                f"(-{risparmio_pct:.0f}%)"
                + (f"  [{dim_orig[0]}×{dim_orig[1]} → {dim_new[0]}×{dim_new[1]}]" if ridimensionata else "  [dimensioni invariate]")
            )

            totale_orig += peso_orig
            totale_out  += peso_out
            risultati.append((foto_path, out_path))

        except Exception as e:
            print(f"❌  Errore: {e}")


    risparmio_tot = (1 - totale_out / totale_orig) * 100 if totale_orig > 0 else 0
    print(f"\n{'─' * 60}")
    print(f"  Spazio originale  : {formatta_bytes(totale_orig)}")
    print(f"  Spazio ottimizzato: {formatta_bytes(totale_out)}")
    print(f"  Risparmio totale  : {formatta_bytes(totale_orig - totale_out)} (-{risparmio_tot:.0f}%)")
    print(f"{'─' * 60}\n")

    print(f"✅  File ottimizzati salvati in: {cartella_out}/")
    print(f"    Gli originali in '{cartella}/' sono intatti.\n")

    if args.sovrascrivi:
        conferma = input("⚠️   Vuoi sovrascrivere gli originali? [s/N] ").strip().lower()
        if conferma == "s":
            for orig, ottim in risultati:
                shutil.copy2(ottim, orig)
            shutil.rmtree(cartella_out)
            print(f"✅  Originali sostituiti. Cartella 'ottimizzate/' rimossa.")
        else:
            print("   Operazione annullata. Gli originali sono intatti.")
    else:
        print("💡  Per sovrascrivere gli originali riesegui con --sovrascrivi")


if __name__ == "__main__":
    main()