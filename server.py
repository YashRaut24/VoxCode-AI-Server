from flask import Flask, request, jsonify
from flask_cors import CORS
import whisper
import traceback
import tempfile
import os
import re

def clean_text(text):
    text = text.lower()
    text = re.sub(r'[^a-z0-9 ]', '', text)  # remove symbols
    return text.strip()

app = Flask(__name__)
CORS(app)

print("🔥 Loading Whisper model...")
model = whisper.load_model("base")
print("✅ Whisper model loaded!")

@app.route("/")
def home():
    return "VoxCode Python AI Server Running"

def detect_intent(text):
    text = clean_text(text)

    print("🔍 Cleaned text:", text)

    # EXPLAIN intent
    if any(word in text for word in ["explain", "what is", "how does", "meaning"]):
        return "EXPLAIN"

    # DEBUG intent (tolerant + misheard words)
    if any(word in text for word in [
        "fix", "error", "bug", "issue", "solve", "not working",
        "arrow", "terror", "eror", "err", "problem"
    ]):
        return "DEBUG"

    # WRITE intent
    if any(word in text for word in ["create", "write", "make", "generate", "build"]):
        return "WRITE"

    return "WRITE"

def handle_write(text):
    return {
        "response" : f"WRITE handler received: {text}",
        "intent": "WRITE" 
    }

def handle_explain(text):
    return {
        "response" : f"EXPLAIN handler received: {text}",
        "intent": "EXPLAIN"
    }

def handle_debug(text):
    return {
        "response" : f"DEBUG handler received: {text}",
        "intent" : "DEBUG"
    }

def route_intent(intent, text):

    if intent == "WRITE":
        return handle_write(text)

    elif intent == "EXPLAIN":
        return handle_explain(text)

    elif intent == "DEBUG":
        return handle_debug(text)

    return handle_write(text)

@app.route("/api/ai", methods=["POST"])
def ai():
    try:
        if "audio" in request.files:
            file = request.files["audio"]

            with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp:
                file.save(temp.name)
                temp_path = temp.name

            print("Saved audio:", temp_path)

            result = model.transcribe(temp_path)
            text = result["text"]
            text = clean_text(text)

            os.remove(temp_path)

        else:
            data = request.json
            text = data.get("prompt", "")
            text = clean_text(text)
            selected_code = data.get("selectedCode", "")
            full_code = data.get("fullCode", "")
            language = data.get("language", "")
            file_name = data.get("fileName", "")

        print("Transcribed:", text)

        # 🔥 INTENT DETECTION (single place)
        intent = detect_intent(text)

        print("Detected intent:", intent)

        result = route_intent(intent, text)

        return jsonify(result)

    except Exception as e:
        print("🔥 FULL ERROR BELOW:")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    
if __name__ == "__main__":
    app.run(port=5000)