// server.js (Финальная профессиональная версия, V11 + Интеграция Режимов Работы)
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const winston = require('winston');
const Joi = require('joi');
require('dotenv').config({ path: __dirname + '/.env' }); // Убедитесь, что .env в той же папке

// ВАЖНО: Buffer используется для 'base64', но это встроенный модуль Node.js, импорт не нужен.

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
  duration: 60 // в минуту (в V11 было 60 сек, во втором файле 1 сек. 60 безопаснее)
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

// Схема для /generate-prompt (из V11)
const promptSchema = Joi.object({
  idea: Joi.string().min(3).required(),
  parameters: Joi.object({
    sceneComplexity: Joi.number().min(1).max(10),
    intensityLevels: Joi.string().valid('slightly', 'moderately', 'extremely'),
    generationModel: Joi.string().optional()
  }).unknown(true),
  mode: Joi.string().valid('auto-pilot', 'super-improve', 'improve').required(),
  operatingMode: Joi.string().valid('general', 'no-names', 'base64').optional()
});

// Схема для /generate-tags (из V11)
const tagsSchema = Joi.object({
  idea: Joi.string().min(3).required(),
  prompt: Joi.string().min(10).required(),
  generationModel: Joi.string().optional()
});

// Схема для /predict-problems (из V11)
const problemsSchema = Joi.object({
  idea: Joi.string().min(3).required(),
  prompt: Joi.string().min(10).required(),
  generationModel: Joi.string().optional()
});

// Схема для /generate-negative-prompt (из V11)
const negativePromptSchema = Joi.object({
  prompt: Joi.string().min(10).required(),
  generationModel: Joi.string().optional(),
  clean: Joi.boolean().optional()
});

// Схема для /translate (из V11)
const translateSchema = Joi.object({
  text: Joi.string().min(1).required(),
  generationModel: Joi.string().optional()
});

// Схема для /generate-ideas (из V11)
const ideasSchema = Joi.object({
  generationModel: Joi.string().optional(),
  type: Joi.string().valid('subject', 'style', 'quality').default('subject')
});

// Middleware для валидации (из V11)
const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body);
  if (error) {
    logger.warn(`Validation error: ${error.details[0].message}`);
    return res.status(400).json({ error: error.details[0].message });
  }
  next();
};

function addComplexityDetails(prompt, sceneComplexity) {
    if (sceneComplexity > 7) {
        prompt += ", ultra-detailed, 8k, trending on artstation";
    } else if (sceneComplexity > 5) {
        prompt += ", highly detailed, photorealistic";
    }
    return prompt;
}

function applyIntensity(prompt, intensity) {
    const intensityMap = {
        'slightly': 'slightly foggy',
        'moderately': 'moderately smoky',
        'extremely': 'extremely dense fog'
    };
    return prompt.replace(/\bfog\b/gi, intensityMap[intensity] || 'fog');
}

const generatePromptHandler = async (req, res, next) => {
  try {
    const { idea, parameters, mode, operatingMode } = req.body;
    const modelName = parameters.generationModel || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({ model: modelName });
    logger.info(`Using model (Prompt): ${modelName}, Mode: ${mode}, OperatingMode: ${operatingMode}`);

    // --- Логика V11 (Режим 'auto-pilot' / 'improve') ---
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
    let generatedPrompt = result.response.text().trim(); // Используем let для возможности изменения

    generatedPrompt = addComplexityDetails(generatedPrompt, parameters.sceneComplexity);
    generatedPrompt = applyIntensity(generatedPrompt, parameters.intensityLevels);

    // --- ДОБАВЛЕНО: Логика "Режима Работы" из второго файла ---
    if (operatingMode === 'no-names') {
        logger.info('Applying no-names filter...');
        const noNamesPrompt = `Rewrite the following prompt to avoid using any specific names of people, brands, or characters. Instead, use descriptive language. For example, instead of "Harry Potter", you could say "a young wizard with a lightning scar". Respond only with the rewritten prompt.\n\nOriginal prompt: "${generatedPrompt}"`;
       
        // Используем ту же модель
        const noNamesResult = await model.generateContent(noNamesPrompt);
        generatedPrompt = noNamesResult.response.text().trim();

    } else if (operatingMode === 'base64') {
        logger.info('Applying base64 filter...');
        // Логика из второго файла для кодирования
        const properNouns = ['Harry', 'Potter', 'Disney', 'Marvel', 'Netflix']; // расширьте список
        generatedPrompt = generatedPrompt.replace(/\b[A-Z][a-z]{2,}\b/g, (match) => {
            return properNouns.includes(match) ? Buffer.from(match).toString('base64') : match;
        });
    }
    // --- Конец добавленной логики ---

    res.json({ generatedPrompt });
    logger.info('Prompt generated successfully');
  } catch (error) {
    next(error);
  }
};

// Обработчик /api/generate-tags (из V11)
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

// Обработчик /api/predict-problems (из V11)
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

// Обработчик /api/generate-negative-prompt (из V11, т.к. промпт лучше)
const generateNegativePromptHandler = async (req, res, next) => {
    try {
        const { prompt, generationModel, clean } = req.body;
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
        let generatedNegative = result.response.text().trim();

        if (clean) {
            const commonErrors = /\b(bad anatomy|low quality|artifacts)\b,? */gi;
            generatedNegative = generatedNegative.replace(commonErrors, '');
            generatedNegative = generatedNegative.replace(/, *,/g, ',').replace(/^, *|, *$/g, '').trim();
        }

        res.json({ generatedNegative });
        logger.info('Negative prompt generated successfully');
    } catch (error) {
        next(error);
    }
};

// Обработчик /api/translate (из V11, т.к. промпт лучше)
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
        next(error);
    }
};

// Обработчик /api/generate-ideas (из V11, т.к. промпт лучше)
const generateIdeasHandler = async (req, res, next) => {
    try {
        const { generationModel, type } = req.body;
        const modelName = generationModel || 'gemini-2.5-flash';
        const model = genAI.getGenerativeModel({ model: modelName });
        let prompt;
        switch (type) {
            case 'style':
                prompt = `Generate a single, creative, and interesting idea for a video's style and lighting. Respond only with the idea text.`;
                break;
            case 'quality':
                prompt = `Generate a single, creative, and interesting idea for a video's quality and resolution. Respond only with the idea text.`;
                break;
            default:
                prompt = `Generate a single, creative, and interesting idea for a video. Respond only with the idea text.`;
        }
        const result = await model.generateContent(prompt);
        const idea = result.response.text().trim();
        res.json({ idea });
        logger.info('Idea generated successfully');
    } catch (error) {
        next(error);
    }
};

// --- Маршруты ---
// Используем middleware валидации из V11 для всех маршрутов
app.post('/api/generate-prompt', validate(promptSchema), generatePromptHandler);
app.post('/api/generate-tags', validate(tagsSchema), generateTagsHandler);
app.post('/api/predict-problems', validate(problemsSchema), predictProblemsHandler);
app.post('/api/generate-negative-prompt', validate(negativePromptSchema), generateNegativePromptHandler);
app.post('/api/translate', validate(translateSchema), translateHandler);
app.post('/api/generate-ideas', validate(ideasSchema), generateIdeasHandler);

// --- Централизованная обработка ошибок (из V11) ---
app.use((err, req, res, next) => {
  logger.error(`Unhandled Error: ${err.message}`, { stack: err.stack, ip: req.ip });
  res.status(500).json({ error: 'Internal Server Error' });
});

// --- Запуск сервера ---
app.listen(port, () => {
  logger.info(`Production-ready server listening at http://localhost:${port}`);
});
