const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => {
    res.json({ status: "VoxCode AI server running" });
});

// AI endpoint
app.post("/api/ai", async (req, res) => {
    const { prompt, selectedCode, fullCode, language, fileName } = req.body;

    // Input validation
    if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
        return res.status(400).json({ error: "Prompt is required" });
    }

    if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "Server is missing API key configuration" });
}

    try {
        // Build context-aware prompt
        const contextParts = [];

        if (language) contextParts.push(`Language: ${language}`);
        if (fileName) contextParts.push(`File: ${fileName}`);
        if (selectedCode) contextParts.push(`Selected code:\n\`\`\`\n${selectedCode}\n\`\`\``);
        else if (fullCode) contextParts.push(`Full file code:\n\`\`\`\n${fullCode}\n\`\`\``);

        const context = contextParts.length > 0
            ? `Context:\n${contextParts.join("\n")}\n\n`
            : "";

        const fullPrompt = `You are VoxCode AI, an expert coding assistant inside VS Code.
${context}User instruction: ${prompt}

Respond with raw code only. No markdown formatting, no backticks, no code fences, no explanation. Just the code itself.`;

        console.log("Sending prompt to Gemini...");

        // Call Gemini API
 let aiRes;
let attempts = 0;
const maxAttempts = 3;

while (attempts < maxAttempts) {
    aiRes = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: fullPrompt }],
                temperature: 0.2
            })
        }
    );

    if (aiRes.status === 429) {
        attempts++;
        console.log(`Rate limited. Attempt ${attempts} of ${maxAttempts}. Waiting 10 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 10000));
        continue;
    }

    break;
}

if (!aiRes.ok) {
    const errorBody = await aiRes.text();
    console.error("AI provider error:", errorBody);
    return res.status(502).json({ error: "AI provider returned an error" });
}

const aiData = await aiRes.json();
const aiText = aiData?.choices?.[0]?.message?.content;        if (!aiText) {
            console.error("Unexpected Gemini response shape:", JSON.stringify(geminiData));
            return res.status(502).json({ error: "Unexpected response from AI provider" });
        }

        console.log("Gemini responded successfully");

        res.json({ response: aiText });

    } catch (err) {
        console.error("Server error:", err.message);
        res.status(500).json({ error: "Internal server error" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`VoxCode AI server running on http://localhost:${PORT}`);
});