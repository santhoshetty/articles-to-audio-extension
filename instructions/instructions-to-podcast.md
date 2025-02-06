Sample Code


import requests
import time
import json
from pydub import AudioSegment

# OpenAI API Key
OPENAI_API_KEY = "YOUR_OPENAI_API_KEY"

# Sample article summaries
article_summaries = [
    "Scientists have discovered a new exoplanet that could potentially support life. It orbits a star similar to our sun and has a stable atmosphere.",
    "The stock market saw a sharp decline today as investors reacted to the latest Federal Reserve interest rate hike. Experts predict continued volatility."
]

# Conversation prompt for GPT-4
prompt = f"""
You are two podcast hosts, Alice and Bob.
Discuss the following news articles in a conversational and engaging way.

Article 1: {article_summaries[0]}
Article 2: {article_summaries[1]}

Format it like a real dialogue:
Alice: (Introduction)
Bob: (Comment)
Alice: (More details)
Bob: (Opinion)
Continue this structure.
"""

def generate_conversation():
    """ Generate a podcast script using OpenAI's Chat API (GPT-4) """
    url = "https://api.openai.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"}
    
    data = {
        "model": "gpt-4",
        "messages": [{"role": "system", "content": prompt}],
        "max_tokens": 1000
    }
    
    response = requests.post(url, headers=headers, json=data)
    
    if response.status_code == 200:
        conversation = response.json()["choices"][0]["message"]["content"].strip()
        return conversation
    else:
        print("❌ GPT-4 Error:", response.text)
        return None

def generate_speech(text, voice="alloy", filename="audio.mp3"):
    """ Convert text to speech using OpenAI's TTS API """
    url = "https://api.openai.com/v1/audio/speech"
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"}
    payload = {"model": "tts-1", "voice": voice, "input": text}

    response = requests.post(url, headers=headers, json=payload)

    if response.status_code == 200:
        with open(filename, "wb") as f:
            f.write(response.content)
        print(f"✅ Audio saved as {filename}")
        return filename
    else:
        print(f"❌ TTS Error: {response.text}")
        return None

def create_podcast(conversation):
    """ Generate podcast-style audio from a conversation script """
    if not conversation:
        print("❌ No conversation generated.")
        return
    
    lines = conversation.split("\n")
    audio_files = []
    
    for i, line in enumerate(lines):
        if ":" in line:
            speaker, dialogue = line.split(":", 1)
            voice = "onyx" if speaker.strip() == "Bob" else "alloy"  # Change voices for speakers
            filename = f"segment_{i}.mp3"
            audio_path = generate_speech(dialogue.strip(), voice, filename)
            
            if audio_path:
                audio_files.append(audio_path)
            time.sleep(1)  # Prevent API rate limiting
    
    # Merge all audio clips into a single podcast
    podcast = AudioSegment.empty()
    for file in audio_files:
        segment = AudioSegment.from_mp3(file)
        podcast += segment + AudioSegment.silent(duration=500)  # Add short pause
    
    podcast.export("podcast.mp3", format="mp3")
    print("🎙️ Podcast saved as podcast.mp3")

if __name__ == "__main__":
    conversation = generate_conversation()
    print("Generated Conversation:\n", conversation)
    create_podcast(conversation)
