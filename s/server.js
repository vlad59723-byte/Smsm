// server.js (ФИНАЛЬНАЯ РАБОЧАЯ ВЕРСИЯ С "AI-Автопилотом")
const express = require('express');
const cors = require('cors');
require('dotenv').config({ path: __dirname + '/.env' }); // Загружает переменные из .env

const genAIModule = require('@google/generative-ai');

const app = express();
const port = 3000;

// Инициализация Gemini API
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("Error: GEMINI_API_KEY not found in .env file.");
    process.exit(1);
}

const genAI = new genAIModule.GoogleGenerativeAI(apiKey);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Serve static files from the current directory

// --- Главный маршрут для генерации промпта ---
app.post('/api/generate-prompt', async (req, res) => {
    try {
        const { idea, style, mood, artistic_style, additional_params } = req.body;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `Based on the following inputs, generate a concise and effective prompt for an AI video generation model.
        The prompt should be in English.

        **Core Idea:** ${idea}
        **Visual Style:** ${style}
        **Mood:** ${mood}
        **Artistic Style:** ${artistic_style}
        **Additional Parameters:** ${additional_params}

        Combine these elements into a single, coherent prompt string.`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const generatedPrompt = response.text();

        res.json({ generatedPrompt });

    } catch (error) {
        console.error("Error during prompt generation:", error);
        res.status(500).json({ error: "Failed to generate prompt. See server logs for details." });
    }
});

app.post('/api/generate-tags', async (req, res) => {
    try {
        const { idea, prompt } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const generationPrompt = `Based on the following idea and generated prompt, suggest a list of relevant tags for a video. The tags should be comma-separated.

        **Idea:** ${idea}
        **Prompt:** ${prompt}

        Suggest tags:`;

        const result = await model.generateContent(generationPrompt);
        const response = await result.response;
        const generatedTags = response.text();
        res.json({ generatedTags });
    } catch (error) {
        console.error("Error during tag generation:", error);
        res.status(500).json({ error: "Failed to generate tags." });
    }
});

app.post('/api/predict-problems', async (req, res) => {
    try {
        const { idea, prompt } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const generationPrompt = `Based on the following idea and generated prompt for an AI video, predict potential problems or unwanted artifacts that might occur. This will be used as a "negative prompt". List the potential problems as a comma-separated list.

        **Idea:** ${idea}
        **Prompt:** ${prompt}
        
        Predict potential problems:`;
        
        const result = await model.generateContent(generationPrompt);
        const response = await result.response;
        const predictedProblems = response.text();
        res.json({ predictedProblems });
    } catch (error) {
        console.error("Error during problem prediction:", error);
        res.status(500).json({ error: "Failed to predict problems." });
    }
});


// Запуск сервера
app.listen(port, () => {
    console.log(`Proxy server listening at http://localhost:${port}`);
    console.log("Access is protected by API Key on the server side.");
});
