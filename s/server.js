// server.js (Финальная профессиональная версия, совместимая с v11 + Negative Prompt)
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

// --- Схемы валидации Joi (ИСПРАВЛЕНЫ) ---
// Схема для /generate-prompt
const promptSchema = Joi.object({
  idea: Joi.string().min(3).required(),
  // "parameters" - это объект, который присылает v11
  parameters: Joi.object().required(), 
  mode: Joi.string().valid('auto-pilot', 'super-improve', 'improve').required()
});

// Схема для /generate-tags
const tagsSchema = Joi.object({
  idea: Joi.string().min(3).required(),
  prompt: Joi.string().min(10).required(),
  generationModel: Joi.string().optional() // v11 присылает это
});

// Схема для /predict-problems
const problemsSchema = Joi.object({
  idea: Joi.string().min(3).required(),
  prompt: Joi.string().min(10).required(),
  generationModel: Joi.string().optional() // v11 присылает это
});

// --- НОВОЕ: Схема для /generate-negative-prompt ---
const negativePromptSchema = Joi.object({
  prompt: Joi.string().min(10).required(),
  generationModel: Joi.string().optional()
});
// --- КОНЕЦ НОВОГО ---

// Middleware для валидации
const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body);
  if (error) {
    logger.warn(`Validation error: ${error.details[0].message}`);
    return res.status(400).json({ error: error.details[0].message });
  }
  next();
};

// --- Обработчик /api/generate-prompt (ИСПРАВЛЕН) ---
const generatePromptHandler = async (req, res, next) => {
  try {
    // 1. ПРАВИЛЬНАЯ ДЕСТРУКТУРИЗАЦИЯ
    const { idea, parameters, mode } = req.body;
    const modelName = parameters.generationModel || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({ model: modelName });
    logger.info(`Using model (Prompt): ${modelName}, Mode: ${mode}`);

    let systemInstruction;
    if (mode === 'auto-pilot') {
      // Логика автопилота (она не использует 'parameters', только 'idea',
      // поэтому она работала у вас и раньше)
      systemInstruction = `
        Вы — элитный режиссер...
        ИДЕЯ ПОЛЬЗОВАТЕЛЯ: "${idea}"
        ВАША ЗАДАЧА: ...САМОСТОЯТЕЛЬНО выберите...
        5. Отвечайте только финальным промптом.
      `;
    } else {
      // 2. ПРАВИЛЬНАЯ ЛОГИКА для 'improve' и 'super-improve'
      // Мы передаем *ВЕСЬ* объект 'parameters', а не undefined переменные
      systemInstruction = `
        Вы — эксперт по созданию профессиональных...
        ИСХОДНЫЕ ДАННЫЕ:
        Базовая идея: "${idea}"
        Режим: ${mode === 'super-improve' ? 'Максимально детализировать' : 'Улучшить'}
        
        // 3. ВОТ ИСПРАВЛЕНИЕ:
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
    next(error); // Передача в централизованный обработчик
  }
};

// --- Обработчик /api/generate-tags (ИСПРАВЛЕН) ---
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

// --- Обработчик /api/predict-problems (ИСПРАВЛЕН) ---
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

// --- НОВОЕ: Обработчик /api/generate-negative-prompt ---
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
// --- КОНЕЦ НОВОГО ---


// --- Маршруты ---
app.post('/api/generate-prompt', validate(promptSchema), generatePromptHandler);
app.post('/api/generate-tags', validate(tagsSchema), generateTagsHandler);
app.post('/api/predict-problems', validate(problemsSchema), predictProblemsHandler);

// --- НОВОЕ: Регистрация маршрута ---
app.post('/api/generate-negative-prompt', validate(negativePromptSchema), generateNegativePromptHandler);
// --- КОНЕЦ НОВОГО ---


// --- Централизованная обработка ошибок ---
app.use((err, req, res, next) => {
  logger.error(`Unhandled Error: ${err.message}`, { stack: err.stack, ip: req.ip });
  res.status(500).json({ error: 'Internal Server Error' });
});

// --- Запуск сервера ---
app.listen(port, () => {
  logger.info(`Production-ready server listening at http://localhost:${port}`);
});
