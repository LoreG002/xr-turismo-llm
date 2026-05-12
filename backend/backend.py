import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq

load_dotenv()

#client = genai.Client(api_key=os.getenv("GEMINI_API_KEY" ))
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/spiegazione/{luogo}")
async def get_spiegazione(luogo: str):
    prompt = f"Sei una guida turistica esperta in Mixed Reality. Descrivi in modo immersivo e dettagliato (circa 100-120 parole) il seguente luogo: {luogo}. Focalizzati su dettagli visivi interessanti, contesto storico e curiosità."
    
    """response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=prompt
    )"""
    
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=500,
    )
    
    return {"text": response.choices[0].message.content}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)