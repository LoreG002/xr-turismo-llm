import os
import json
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq

from rag import retrieve, format_contesto_per_prompt, get_model, _load_index

load_dotenv()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL = "llama-3.1-8b-instant"

# =====================================================
# FOTO DISPONIBILI PER GLI APPROFONDIMENTI
# Aggiungi qui i nomi dei file man mano che li carichi in public/pic/
# Convenzione: luogo_concetto.jpg (lowercase con underscore)
# =====================================================
FOTO_DISPONIBILI = [
    "cavour_statua.jpg",
    "duomo_leoni_stilofori.jpg",
    "duomo_leoni.jpg",
    "duomo_portale_romanico.jpg",
    "duomo_veduta.jpg",
    "plebiscito_statua_papa.jpg",
    "plebiscito_veduta.jpg",
]

# Set per lookup O(1) in validazione
_FOTO_SET = set(FOTO_DISPONIBILI)


# =====================================================
# STARTUP: pre-carica modello e indice RAG
# Così al primo click non c'è nessun ritardo
# =====================================================
@app.on_event("startup")
async def startup_event():
    print("[Startup] Pre-carico modello RAG e indice FAISS...")
    get_model()
    _load_index()
    print("[Startup] Pronti. Nessun ritardo al primo click.")


# =====================================================
# SYSTEM PROMPT PERSISTENTE
# =====================================================
SYSTEM_GUIDA = """Sei Marco, una guida culturale italiana con 25 anni di esperienza
specializzata in storia dell'arte e architettura delle Marche e di Ancona.
Il tuo stile è coinvolgente, narrativo, ricco di dettagli sensoriali e aneddoti storici.
Quando descrivi un argomento, lo fai in modo bilanciato (circa 100-150 parole),
costruendo un racconto che mescola fatti storici, descrizioni visive e curiosità poco note.
Il tuo lavoro è far rivivere i luoghi attraverso parole dense e immersive ma senza dilungarti troppo.
Non usi mai elenchi puntati, titoli o formattazione markdown. Solo prosa scorrevole."""


# =====================================================
# ENDPOINT 1: SPIEGAZIONE PRINCIPALE
# =====================================================
@app.get("/spiegazione/{luogo}")
async def get_spiegazione(luogo: str):
    # k=6: più chunk → più varietà di argomenti per gli approfondimenti
    chunks = retrieve(query=luogo, luogo_id=luogo, k=6)
    contesto_rag = format_contesto_per_prompt(chunks)
    print(f"[/spiegazione] {luogo} → {len(chunks)} chunk recuperati")

    prompt = f"""{contesto_rag}

Descrivi il luogo: {luogo}

Rispondi SOLO con un JSON valido in questo formato:
{{
  "descrizione": "testo immersivo di circa 140-150 parole con dettagli visivi, contesto storico e curiosità",
  "approfondimenti": [
    {{"label": "Etichetta breve (max 3 parole)", "argomento": "nome_concetto", "contesto": "frase che inquadra il concetto nel luogo specifico"}},
    {{"label": "...", "argomento": "...", "contesto": "..."}},
    {{"label": "...", "argomento": "...", "contesto": "..."}}
  ]
}}

REGOLE per gli approfondimenti:
- ESATTAMENTE 3 concetti chiave menzionati nella descrizione
- I 3 approfondimenti devono coprire ARGOMENTI DISTINTI tra loro:
  uno architettonico/artistico, uno storico/politico, uno su curiosità o aneddoti locali
- Privilegia dettagli specifici e insoliti rispetto a quelli ovvi o generici
- "label": breve e accattivante (max 3 parole), es. "Il portale romanico"
- "argomento": il nome specifico del concetto, es. "portale romanico del Duomo di Ancona"
- "contesto": una frase che spiega COSA c'è di interessante da approfondire,
   es. "le sculture zoomorfe del portale e il loro significato simbolico medievale"

Gli approfondimenti devono essere context-aware: legati SPECIFICAMENTE a {luogo},
non concetti generici. Nessun testo fuori dal JSON, nessun markdown."""

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_GUIDA},
            {"role": "user", "content": prompt},
        ],
        max_tokens=3000,
        temperature=0.85,  # più alta → più varietà negli approfondimenti
        response_format={"type": "json_object"},
    )
    data = json.loads(response.choices[0].message.content)

    approfondimenti_ricchi = []
    for app in data.get("approfondimenti", []):
        label = app.get("label", "")
        argomento = app.get("argomento", label)
        contesto = app.get("contesto", "")

        query_payload = {
            "argomento": argomento,
            "contesto": contesto,
            "luogo_origine": luogo,
        }
        approfondimenti_ricchi.append({
            "label": label,
            "query": json.dumps(query_payload, ensure_ascii=False),
        })

    return {
        "descrizione": data.get("descrizione", ""),
        "approfondimenti": approfondimenti_ricchi,
    }


# =====================================================
# ENDPOINT 2: APPROFONDIMENTO (con retry intelligente)
# =====================================================
FEW_SHOT_APPROFONDIMENTO = [
    {
        "role": "user",
        "content": """Scrivi un approfondimento culturale immersivo su questo argomento.
ARGOMENTO: simbolismo dei leoni stilofori
CONTESTO: i leoni di marmo rosso che reggono le colonne del protiro del Duomo di Ancona
LUOGO DI ORIGINE: Duomo di San Ciriaco, Ancona

FOTO DISPONIBILI: ["Leoni_Stilofori.jpg", "Portale_Duomo.jpg", "Interno_Duomo.jpg"]

Lunghezza richiesta: circa 80-100 parole. Stile: prosa narrativa, immersiva, ricca di dettagli storici e visivi.

Rispondi SOLO con un JSON valido in questo formato esatto:
{"descrizione": "il testo dell'approfondimento", "immagine": "nome_file.jpg oppure null"}

REGOLE per "immagine":
- Scegli il file dalla LISTA "FOTO DISPONIBILI" che meglio illustra l'argomento.
- Se nessuna foto è davvero pertinente, metti null.
- NON inventare nomi di file: usa SOLO quelli presenti nella lista."""
    },
    {
        "role": "assistant",
        "content": """{"descrizione": "I leoni stilofori in marmo rosso del Duomo di San Ciriaco non sono semplici decorazioni, ma antichi guardiani di pietra scolpiti nel XIII secolo. Nella simbologia medievale, il leone era ritenuto l'animale che dorme con gli occhi aperti, incarnando così il Cristo risorto e la Chiesa sempre vigile contro il male. Sotto le loro possenti zampe schiacciano altre creature, a perenne monito della vittoria sui peccatori. Quel marmo rosso veronese, scelto con cura per evocare il sangue dei martiri, ha visto scorrere secoli di pellegrini e crociati in partenza dal porto di Ancona.", "immagine": "Leoni_Stilofori.jpg"}"""
    }
]


def costruisci_prompt_approfondimento(payload_str: str):
    """Estrae il contesto dalla query e costruisce un prompt ricco."""
    try:
        payload = json.loads(payload_str)
        argomento = payload.get("argomento", payload_str)
        contesto = payload.get("contesto", "")
        luogo = payload.get("luogo_origine", "")
    except (json.JSONDecodeError, TypeError):
        argomento = payload_str
        contesto = ""
        luogo = ""

    query_rag = f"{argomento}. {contesto}".strip()
    chunks = retrieve(
        query=query_rag,
        luogo_id=luogo if luogo else None,
        k=1,
    )
    contesto_rag = format_contesto_per_prompt(chunks)
    print(f"[/approfondimento] '{argomento}' → {len(chunks)} chunk recuperati")

    foto_lista_str = json.dumps(FOTO_DISPONIBILI, ensure_ascii=False)

    prompt = f"""{contesto_rag}

Scrivi un approfondimento culturale immersivo su questo argomento.
ARGOMENTO: {argomento}
CONTESTO: {contesto if contesto else "approfondimento culturale generale"}
LUOGO DI ORIGINE: {luogo if luogo else "Ancona, Marche"}

FOTO DISPONIBILI: {foto_lista_str}

Lunghezza richiesta: circa 100 parole. Stile: prosa narrativa, immersiva, ricca di dettagli storici e visivi.

Rispondi SOLO con un JSON valido in questo formato esatto:
{{"descrizione": "il testo dell'approfondimento", "immagine": "nome_file.jpg oppure null"}}

REGOLE per "immagine":
- Scegli il file dalla LISTA "FOTO DISPONIBILI" che meglio illustra l'argomento.
- Se nessuna foto è davvero pertinente, metti null.
- NON inventare nomi di file: usa SOLO quelli presenti nella lista."""
    return prompt, argomento


async def genera_approfondimento_con_retry(payload_str: str, tentativi_max: int = 2):
    """Genera l'approfondimento e ritenta se troppo corto.
    Restituisce una tupla (descrizione, immagine) dove immagine è il nome file
    validato contro FOTO_DISPONIBILI, oppure None."""
    prompt, argomento = costruisci_prompt_approfondimento(payload_str)

    testo = ""
    immagine = None

    for tentativo in range(tentativi_max):
        messages = [
            {"role": "system", "content": SYSTEM_GUIDA},
            *FEW_SHOT_APPROFONDIMENTO,
            {"role": "user", "content": prompt},
        ]

        if tentativo > 0:
            messages[-1]["content"] += "\n\nIMPORTANTE: rispetta la lunghezza richiesta. Il testo deve essere di circa 100 parole: sufficientemente immersivo ma non eccessivamente lungo."

        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            max_tokens=1000,
            temperature=0.65 + (tentativo * 0.1),
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content.strip()

        # Parse JSON con fallback robusto
        try:
            data = json.loads(raw)
            testo = (data.get("descrizione") or "").strip()
            img_raw = data.get("immagine")
        except (json.JSONDecodeError, TypeError):
            # Fallback estremo: se il modello non rispetta il JSON,
            # usiamo il raw come testo e nessuna immagine.
            testo = raw
            img_raw = None

        # Validazione anti-hallucination dell'immagine
        if isinstance(img_raw, str) and img_raw.strip() and img_raw.strip().lower() != "null":
            nome = img_raw.strip()
            if nome in _FOTO_SET:
                immagine = nome
            else:
                print(f"[/approfondimento] ⚠ Foto inventata scartata: '{nome}'")
                immagine = None
        else:
            immagine = None

        n_parole = len(testo.split())
        print(f"[Tentativo {tentativo + 1}] Argomento: '{argomento}' — {n_parole} parole — foto: {immagine}")

        if n_parole >= 60:
            return testo, immagine

    return testo, immagine


@app.get("/approfondimento/{argomento}")
async def get_approfondimento(argomento: str):
    print(f"PAYLOAD RICEVUTO: '{argomento[:100]}...'")
    testo, immagine = await genera_approfondimento_con_retry(argomento)
    return {"descrizione": testo, "immagine": immagine}


# =====================================================
# ENDPOINT 3: INFO RAPIDA (hotspot secondari)
# Nessun RAG, nessun JSON parsing, nessun few-shot lungo.
# Solo Groq diretto con prompt secco. ~80 parole.
# =====================================================
@app.get("/info_rapida/{argomento}")
async def get_info_rapida(argomento: str):
    print(f"[/info_rapida] '{argomento[:100]}...'")

    prompt = f"""Descrivi brevemente questo soggetto in circa 70-80 parole.
SOGGETTO: {argomento}

Stile: prosa narrativa, immersiva, con dettagli storici e visivi.
Niente elenchi, niente markdown, niente titoli. Solo prosa scorrevole."""

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_GUIDA},
            {"role": "user", "content": prompt},
        ],
        max_tokens=400,
        temperature=0.7,
    )
    testo = response.choices[0].message.content.strip()
    print(f"[/info_rapida] {len(testo.split())} parole")
    return {"descrizione": testo}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)