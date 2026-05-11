import os
from google import genai
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


load_dotenv()

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

app = FastAPI()

# Permette al front-end (Three.js/Vite) di comunicare con questo back-end
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/spiegazione/{luogo}")
async def get_spiegazione(luogo: str):
    prompt = f"Sei una guida turistica esperta della storia di Ancona. Descrivi in modo dettagliato e breve (max 50 parole) il seguente luogo: {luogo}. Spiega cos'è e la storia."
    
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=prompt
    )
    
    return {"text": response.text}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)