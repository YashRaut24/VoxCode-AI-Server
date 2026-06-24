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

    if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
        return res.status(400).json({ error: "Prompt is required" });
    }

    if (!process.env.GROQ_API_KEY) {
        return res.status(500).json({ error: "Server is missing API key configuration" });
    }

    // Set SSE headers — keep connection open for streaming
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    try {
        const contextParts = [];
        if (language) contextParts.push(`Language: ${language}`);
        if (fileName) contextParts.push(`File: ${fileName}`);
        if (selectedCode) contextParts.push(`Selected code:\n\`\`\`\n${selectedCode}\n\`\`\``);
        else if (fullCode) contextParts.push(`Full file code:\n\`\`\`\n${fullCode}\n\`\`\``);

        if (Array.isArray(req.body.workspaceContext) && req.body.workspaceContext.length > 0) {
            const relatedFilesText = req.body.workspaceContext
                .map(f => `File: ${f.fileName}\n\`\`\`\n${f.content}\n\`\`\``)
                .join('\n\n');
            contextParts.push(`Related files in the workspace:\n${relatedFilesText}`);
        }

        const context = contextParts.length > 0
            ? `Context:\n${contextParts.join("\n")}\n\n`
            : "";

        const fullPrompt = `You are VoxCode AI, an expert coding assistant inside VS Code.
${context}User instruction: ${prompt}

First line of your response must be exactly one of:
INTENT: WRITE
INTENT: EXPLAIN
INTENT: DEBUG
INTENT: REFACTOR

Choose based on these rules:
- WRITE: user wants new code generated
- REFACTOR: user wants existing code rewritten or improved
- EXPLAIN: user wants understanding of code, no file changes
- DEBUG: user wants help finding or fixing a bug

After the INTENT line, output your response directly:
- For WRITE or REFACTOR: raw code only, no markdown, no backticks, no commentary
- For EXPLAIN or DEBUG: clear plain-text explanation

No JSON. No markdown fences. No extra text before the INTENT line.`;

        console.log("Streaming request to Groq...");

        let attempts = 0;
        const maxAttempts = 3;
        let aiRes;

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
                        model: "llama-3.1-8b-instant",
                        messages: [{ role: "user", content: fullPrompt }],
                        temperature: 0.2,
                        stream: true
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
            console.error("Groq error:", errorBody);
            res.write(`data: ${JSON.stringify({ error: "AI provider returned an error" })}\n\n`);
            res.end();
            return;
        }

        // Forward Groq's SSE stream to our client
        // Convert response to text and parse SSE lines manually
const responseText = await aiRes.text();
const lines = responseText.split("\n");

for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();

    if (data === "[DONE]") {
        res.write(`data: [DONE]\n\n`);
        continue;
    }

    try {
        const parsed = JSON.parse(data);
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) {
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
    } catch {
        // skip malformed chunks
    }
}

res.write(`data: [DONE]\n\n`);
res.end();
console.log("Stream complete");
    } catch (err) {
        console.error("Server error:", err.message);
        res.write(`data: ${JSON.stringify({ error: "Internal server error" })}\n\n`);
        res.end();
    }
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`VoxCode AI server running on http://localhost:${PORT}`);
});