// server.js (ФИНАЛЬНАЯ РАБОЧАЯ ВЕРСИЯ С "AI-Автопилотом")
const express = require('express');
const cors = require('cors');
require('dotenv').config(); // Загружает переменные из .env

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

// --- Главный маршрут для генерации промпта ---
app.post('/api/generate-prompt', async (req, res) => {
    // Извлекаем все данные из тела запроса
    const { idea, parameters, mode } = req.body;

    if (!idea || !parameters || !mode) {
        return res.status(400).json({ error: "Missing required fields (idea, parameters, mode)." });
    }

    try {
        // --- ДИНАМИЧЕСКИЙ ВЫБОР МОДЕЛИ ---
        const modelName = parameters.generationModel || "gemini-2.5-flash";
        const model = genAI.getGenerativeModel({ model: modelName });
        console.log(`Используется модель: ${modelName}, Режим: ${mode}`); 

        let systemInstruction; // Объявляем переменную для инструкции

        // !!! ВОТ ВАША НОВАЯ ЛОГИКА !!!
        if (mode === 'auto-pilot') {
            // РЕЖИМ АВТОПИЛОТА: Gemini сам выбирает параметры
            systemInstruction = `
                Вы — элитный режиссер и эксперт по созданию промптов для видео-ИИ (Sora/Veo).
                Ваша задача: принять простую идею пользователя и превратить ее в шедевр.
                
                ИДЕЯ ПОЛЬЗОВАТЕЛЯ: "${idea}"

                ВАША ЗАДАЧА:
                1. Проанализируйте идею.
                2. САМОСТОЯТЕЛЬНО выберите лучшие кинематографические параметры (Стиль, План/Камера, Освещение, Настроение, Эффекты) для этой идеи.
                3. Напишите ОДИН, единый, детализированный промпт для генерации видео, используя выбранные вами параметры.
                4. Промпт должен быть художественным, богатым на прилагательные и готовым к немедленной генерации.
                5. Отвечайте только финальным промптом. Не объясняйте свой выбор.
            `;
        } else {
            // СТАНДАРТНЫЙ РЕЖИM (Improve / Super-Improve): Gemini использует параметры пользователя
            systemInstruction = `
                Вы — эксперт по созданию профессиональных, детализированных промптов (Sora, Veo). 
                Ваша задача — принять базовую идею и технические параметры, а затем сгенерировать единый, максимально качественный и готовый к использованию промпт.

                ИСХОДНЫЕ ДАННЫЕ:
                Базовая идея: "${idea}"
                Режим: ${mode === 'super-improve' ? 'Максимально детализировать' : 'Улучшить'}
                Параметры: ${JSON.stringify(parameters, null, 2)}
                
                ПРАВИЛА ГЕНЕРАЦИИ:
                1. Объедините все параметры в одно, связное, художественное описание.
                2. Начните промпт с описания сцены, а затем переходите к техническим деталям.
                3. Используйте все применимые параметры (Стиль, Камера, Освещение и т.д.) в виде ключевых фраз (например, "Cinematic Wide Shot", "Volumetric Lighting", "Film Grain").
                4. Не включайте в итоговый промпт секции "НЕГАТИВНЫЙ ПРОМПТ" и "ДЛИТЕЛЬНОСТЬ", если они не являются частью самой идеи. Добавьте их в конец в отдельной секции, если они присутствуют.
                5. Если режим 'super-improve', добавьте больше художественных и визуальных метафор.
                6. Отвечайте только финальным промптом.
            `;
        }
        
        // (Остальной код остается без изменений)
        const result = await model.generateContent(systemInstruction);
        const response = await result.response;
        const generatedPrompt = response.text().trim();
        
        res.json({ generatedPrompt });

    } catch (error) {
        console.error("Gemini API call failed:", error);
        res.status(500).json({ error: error.message || "Failed to generate prompt from Gemini API." });
    }
});

// Запуск сервера
app.listen(port, () => {
    console.log(`Proxy server listening at http://localhost:${port}`);
    console.log("Access is protected by API Key on the server side.");
});