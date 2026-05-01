from flask import Flask, request, jsonify
from flask_cors import CORS
import whisper
import traceback
import tempfile
import os

app = Flask(__name__)
CORS(app)

print("🔥 Loading Whisper model...")
model = whisper.load_model("base")
print("✅ Whisper model loaded!")

@app.route("/")
def home():
    return "VoxCode Python AI Server Running"

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

            print("Transcribed:", text)

            os.remove(temp_path)

        else:
            data = request.json
            text = data.get("prompt", "")

        return jsonify({"response": text})

    except Exception as e:
        print("🔥 FULL ERROR BELOW:")
        traceback.print_exc()   # 👈 THIS IS CRUCIAL
        return jsonify({"error": str(e)}), 500
    
    
if __name__ == "__main__":
    app.run(port=5000)