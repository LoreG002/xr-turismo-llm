
import os
import json
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq

load_dotenv()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL = "llama-3.3-70b-versatile"

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
    prompt = f"""Descrivi il luogo: {luogo}

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
        temperature=0.7,
        response_format={"type": "json_object"},
    )
    data = json.loads(response.choices[0].message.content)

    # Trasforma in formato compatibile con il frontend esistente
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

# Few-shot examples: mostrano al modello COME deve essere lungo l'output (dimezzato)
FEW_SHOT_APPROFONDIMENTO = [
    {
        "role": "user",
        "content": """Scrivi un approfondimento culturale immersivo su questo argomento.
ARGOMENTO: simbolismo dei leoni stilofori
CONTESTO: i leoni di marmo rosso che reggono le colonne del protiro del Duomo di Ancona
LUOGO DI ORIGINE: Duomo di San Ciriaco, Ancona

Lunghezza richiesta: circa 80-100 parole. Stile: prosa narrativa, immersiva, ricca di dettagli storici e visivi."""
    },
    {
        "role": "assistant",
        "content": """I leoni stilofori in marmo rosso del Duomo di San Ciriaco non sono semplici decorazioni, ma antichi guardiani di pietra scolpiti nel XIII secolo. Nella simbologia medievale, il leone era ritenuto l'animale che dorme con gli occhi aperti, incarnando così il Cristo risorto e la Chiesa sempre vigile contro il male. Sotto le loro possenti zampe schiacciano altre creature, a perenne monito della vittoria sui peccatori. Quel marmo rosso veronese, scelto con cura per evocare il sangue dei martiri, ha visto scorrere secoli di pellegrini e crociati in partenza dal porto di Ancona."""
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
        # Fallback se la query è una stringa secca (retrocompatibilità)
        argomento = payload_str
        contesto = ""
        luogo = ""

    prompt = f"""Scrivi un approfondimento culturale immersivo su questo argomento.
ARGOMENTO: {argomento}
CONTESTO: {contesto if contesto else "approfondimento culturale generale"}
LUOGO DI ORIGINE: {luogo if luogo else "Ancona, Marche"}

Lunghezza richiesta: circa 100 parole. Stile: prosa narrativa, immersiva, ricca di dettagli storici e visivi."""
    return prompt, argomento


async def genera_approfondimento_con_retry(payload_str: str, tentativi_max: int = 2):
    """Genera l'approfondimento e ritenta se troppo corto o eccessivamente lungo."""
    prompt, argomento = costruisci_prompt_approfondimento(payload_str)

    for tentativo in range(tentativi_max):
        # Costruzione messaggi con few-shot
        messages = [
            {"role": "system", "content": SYSTEM_GUIDA},
            *FEW_SHOT_APPROFONDIMENTO,
            {"role": "user", "content": prompt},
        ]

        # Al secondo tentativo, alza la temperature e rafforza il prompt
        if tentativo > 0:
            messages[-1]["content"] += "\n\nIMPORTANTE: rispetta la lunghezza richiesta. Il testo deve essere di circa 100 parole: sufficientemente immersivo ma non eccessivamente lungo."

        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            max_tokens=1000,
            temperature=0.65 + (tentativo * 0.1),  # alza temp ai retry
        )
        testo = response.choices[0].message.content.strip()

        # Conta le parole — se ha superato le 60 parole, restituisci
        n_parole = len(testo.split())
        print(f"[Tentativo {tentativo + 1}] Argomento: '{argomento}' — {n_parole} parole")

        if n_parole >= 60:
            return testo

    # Se anche dopo i retry è corto, restituiamo comunque l'ultimo output
    return testo


@app.get("/approfondimento/{argomento}")
async def get_approfondimento(argomento: str):
    print(f"PAYLOAD RICEVUTO: '{argomento[:100]}...'")
    testo = await genera_approfondimento_con_retry(argomento)
    return {"descrizione": testo}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)



