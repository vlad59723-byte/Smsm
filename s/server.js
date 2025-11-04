// server.js (Финальная профессиональная версия, V11 + Вспомогательные функции)
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const winston = require('winston');
const Joi = require('joi');
require('dotenv').config({ path: __dirname + '/.env' }); // Убедитесь, что .env в той же папке

const genAIModule = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3000;

// --- Логирование ---
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// --- Инициализация Gemini ---
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  logger.error('GEMINI_API_KEY not found in .env file.');
  process.exit(1);
}
const genAI = new genAIModule.GoogleGenerativeAI(apiKey);

// --- Rate Limiter ---
const rateLimiter = new RateLimiterMemory({
  points: 10, // 10 запросов
  duration: 60 // в минуту
});
const rateLimiterMiddleware = (req, res, next) => {
  rateLimiter.consume(req.ip)
    .then(() => next())
    .catch(() => {
        logger.warn(`Too Many Requests from ${req.ip}`);
        res.status(429).send('Too Many Requests');
    });
};

// --- Middleware ---
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(compression());
app.use(rateLimiterMiddleware);
app.use(express.static(__dirname)); // Раздача ai_prompt_creator_v11_enhanced.html

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/ai_prompt_creator_v11_enhanced.html');
});

app.get('/data.js', (req, res) => {
    res.sendFile(__dirname + '/data.js');
});


// --- Схемы валидации Joi ---

// Схема для /generate-prompt
const promptSchema = Joi.object({
  idea: Joi.string().min(3).required(),
  parameters: Joi.object().required(), 
  mode: Joi.string().valid('auto-pilot', 'super-improve', 'improve').required(),
  // ДОБАВЛЕНО: Валидация для "Режима Работы"
  operatingMode: Joi.string().valid('general', 'no-names', 'base64').optional()
});

// Схема для /generate-tags
const tagsSchema = Joi.object({
  idea: Joi.string().min(3).required(),
  prompt: Joi.string().min(10).required(),
  generationModel: Joi.string().optional()
});

// Схема для /predict-problems
const problemsSchema = Joi.object({
  idea: Joi.string().min(3).required(),
  prompt: Joi.string().min(10).required(),
  generationModel: Joi.string().optional()
});

// Схема для /generate-negative-prompt
const negativePromptSchema = Joi.object({
  prompt: Joi.string().min(10).required(),
  generationModel: Joi.string().optional()
});

// --- НОВОЕ: Схема для /translate ---
const translateSchema = Joi.object({
  text: Joi.string().min(1).required(),
  generationModel: Joi.string().optional()
});

// --- НОВОЕ: Схема для /generate-ideas ---
const ideasSchema = Joi.object({
  generationModel: Joi.string().optional()
});

// Middleware для валидации
const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body);
  if (error) {
    logger.warn(`Validation error: ${error.details[0].message}`);
    return res.status(400).json({ error: error.details[0].message });
  }
  next();
};

// --- Обработчики API ---

// Обработчик /api/generate-prompt
const generatePromptHandler = async (req, res, next) => {
  try {
    const { idea, parameters, mode, operatingMode } = req.body; // <-- Добавлен operatingMode
    const modelName = parameters.generationModel || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({ model: modelName });
    logger.info(`Using model (Prompt): ${modelName}, Mode: ${mode}`);

    let systemInstruction;
    if (mode === 'auto-pilot') {
      systemInstruction = `
        Вы — элитный режиссер...
        ИДЕЯ ПОЛЬЗОВАТЕЛЯ: "${idea}"
        ВАША ЗАДАЧА: ...САМОСТОЯТЕЛЬНО выберите...
        5. Отвечайте только финальным промптом.
      `;
    } else {
      systemInstruction = `
        Вы — эксперт по созданию профессиональных...
        ИСХОДНЫЕ ДАННЫЕ:
        Базовая идея: "${idea}"
        Режим: ${mode === 'super-improve' ? 'Максимально детализировать' : 'Улучшить'}
        Параметры: ${JSON.stringify(parameters, null, 2)}
        
        ПРАВИЛА ГЕНЕРАЦИИ:
        1. Объедините все параметры в одно, связное, художественное описание.
        ...
        6. Отвечайте только финальным промптом.
      `;
    }

    const result = await model.generateContent(systemInstruction);
    const generatedPrompt = result.response.text().trim();
    res.json({ generatedPrompt });
    logger.info('Prompt generated successfully');
  } catch (error) {
    next(error);
  }
};

// Обработчик /api/generate-tags
const generateTagsHandler = async (req, res, next) => {
  try {
    const { idea, prompt, generationModel } = req.body;
    const modelName = generationModel || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({ model: modelName });
    logger.info(`Using model (Tags): ${modelName}`);

    const generationPrompt = `
        Вы — ассистент по промпт-инжинирингу.
        Идея: "${idea}"
        Уже сгенерированный промпт: "${prompt}"

        ЗАДАЧА: Предложите 5-7 дополнительных, релевантных тегов (через запятую), которые УЖЕ НЕ ВСТРЕЧАЮТСЯ в промпте, но могут его улучшить (например: "8K, ray tracing, subsurface scattering, masterpiece").
        ОТВЕТ: Только список тегов через запятую.
    `;

    const result = await model.generateContent(generationPrompt);
    const generatedTags = result.response.text().trim();
    res.json({ generatedTags });
    logger.info('Tags generated successfully');
  } catch (error) {
    next(error);
  }
};

// Обработчик /api/predict-problems
const predictProblemsHandler = async (req, res, next) => {
  try {
    const { idea, prompt, generationModel } = req.body;
    const modelName = generationModel || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({ model: modelName });
    logger.info(`Using model (Problems): ${modelName}`);

    const generationPrompt = `
        Вы — QA-тестировщик для ИИ-генераторов видео.
        Промпт для анализа: "${prompt}"

        ЗАДАЧА: Какие 3-5 главных визуальных проблем (артефактов) могут возникнуть при генерации этого промпта?
        ОТВЕТ: Напишите список ключевых слов для НЕГАТИВНОГО промпта, чтобы избежать этих проблем (например: "low quality, blurry, bad anatomy, text, watermark, artifacts").
        Отвечайте только списком тегов через запятую.
    `;
    
    const result = await model.generateContent(generationPrompt);
    const predictedProblems = result.response.text().trim();
    res.json({ predictedProblems });
    logger.info('Problems predicted successfully');
  } catch (error) {
    next(error);
  }
};

// Обработчик /api/generate-negative-prompt
const generateNegativePromptHandler = async (req, res, next) => {
  try {
    const { prompt, generationModel } = req.body;
    const modelName = generationModel || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({ model: modelName });
    logger.info(`Using model (Negative Prompt): ${modelName}`);

    const generationPrompt = `
        Вы — эксперт по негативным промптам для ИИ-генераторов видео.
        ПОЗИТИВНЫЙ ПРОМПТ: "${prompt}"

        ЗАДАЧА: Сгенерируйте краткий список (5-10) ключевых слов для НЕГАТИВНОГО промпта, чтобы избежать распространенных ошибок генерации (артефактов, размытия, плохого качества, деформаций), которые могут возникнуть с этим стилем.
        ОТВЕТ: Только список тегов через запятую.
    `;
    
    const result = await model.generateContent(generationPrompt);
    const generatedNegative = result.response.text().trim();
    res.json({ generatedNegative });
    logger.info('Negative prompt generated successfully');
  } catch (error) {
    next(error);
  }
};

// --- НОВОЕ: Обработчик /api/translate ---
const translateHandler = async (req, res, next) => {
    try {
        const { text, generationModel } = req.body;
        const modelName = generationModel || 'gemini-2.5-flash';
        const model = genAI.getGenerativeModel({ model: modelName });
        const prompt = `Translate the following text to English. Respond only with the translated text: "${text}"`;

        const result = await model.generateContent(prompt);
        const translatedText = result.response.text().trim();
        res.json({ translatedText });
        logger.info('Text translated successfully');
    } catch (error) {
        next(error); // Передача в централизованный обработчик
    }
};

// --- НОВОЕ: Обработчик /api/generate-ideas ---
const generateIdeasHandler = async (req, res, next) => {
    try {
        const { generationModel } = req.body;
        const modelName = generationModel || 'gemini-2.5-flash';
        const model = genAI.getGenerativeModel({ model: modelName });
        const prompt = `Generate a single, creative, and interesting idea for a video. Respond only with the idea text.`;

        const result = await model.generateContent(prompt);
        const idea = result.response.text().trim();
        res.json({ idea });
        logger.info('Idea generated successfully');
    } catch (error) {
        next(error); // Передача в централизованный обработчик
    }
};

// --- Маршруты ---
app.post('/api/generate-prompt', validate(promptSchema), generatePromptHandler);
app.post('/api/generate-tags', validate(tagsSchema), generateTagsHandler);
app.post('/api/predict-problems', validate(problemsSchema), predictProblemsHandler);
app.post('/api/generate-negative-prompt', validate(negativePromptSchema), generateNegativePromptHandler);

// --- НОВОЕ: Регистрация вспомогательных маршрутов ---
app.post('/api/translate', validate(translateSchema), translateHandler);
app.post('/api/generate-ideas', validate(ideasSchema), generateIdeasHandler);

// --- Централизованная обработка ошибок ---
app.use((err, req, res, next) => {
  logger.error(`Unhandled Error: ${err.message}`, { stack: err.stack, ip: req.ip });
  res.status(500).json({ error: 'Internal Server Error' });
});

// --- Запуск сервера ---
app.listen(port, () => {
  logger.info(`Production-ready server listening at http://localhost:${port}`);
});
