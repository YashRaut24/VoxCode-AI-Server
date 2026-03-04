const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors());
app.use(express.json());

app.get("/",(req,res)=>{
    res.send("VoxCode AI server running");
})

app.post("/api/ai", (req,res)=>{
    const {prompt} = req.body;

    console.log("Prompt received:", prompt);

    res.json({
        response: "Dummy AI response for: "+ prompt
    });
});

const PORT = 5000;
app.listen(PORT,()=>{
    console.log(`Server running on http://localhost:${PORT}`);
})