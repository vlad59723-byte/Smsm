// server.js (Финальная профессиональная версия, V11 + Интеграция Режимов Работы)
// (Версия с исправлениями на основе анализа)
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
// РЕШЕНИЕ (Проблема 3: Прокси): Доверяем 1 уровню прокси (NGINX, Cloudflare, Heroku).
// Это позволяет req.ip корректно считывать X-Forwarded-For.
app.set('trust proxy', 1); 

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
  points: 50, // 50 запросов
  duration: 60 // в минуту
});
const rateLimiterMiddleware = (req, res, next) => {
  // Благодаря app.set('trust proxy', 1), req.ip будет правильным 
  // IP пользователя, а не IP прокси-сервера.
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
  }).unknown(true), // .unknown(true) позволяет 'parameters' содержать любые ключи
  mode: Joi.string().valid('auto-pilot', 'super-improve', 'improve').required(),
  operatingMode: Joi.string().valid('general', 'no-names', 'base64').optional(),
  
  // Добавляем поля для Режимов Работы, чтобы Joi их пропускал, если они есть
  noNamesAutoAnalyze: Joi.boolean().optional(),
  noNamesExceptions: Joi.string().allow('').optional(),
  base64Encoding: Joi.string().valid('base64', 'rot13', 'url').optional()
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

const customPresetSchema = Joi.object({
    idea: Joi.string().min(3).required(),
    generationModel: Joi.string().optional()
});

const animeAutoFillSchema = Joi.object({
    title: Joi.string().min(1).required(),
    generationModel: Joi.string().optional()
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

// РЕШЕНИЕ (Проблема 1: Зависимость от "fog"):
// Функция переписана, чтобы добавлять универсальные теги атмосферы/освещения,
// а не заменять конкретное слово "fog".
function applyIntensity(prompt, intensity) {
    if (!intensity) return prompt; // Ничего не делаем, если intensity не указан

    const intensityMap = {
        'slightly': ', slightly atmospheric, subtle lighting',
        'moderately': ', moderately intense, dynamic lighting',
        'extremely': ', extremely vivid, dramatic atmosphere, intense lighting'
    };
    
    // Просто добавляем соответствующий текст в конец промпта
    return prompt + (intensityMap[intensity] || '');
}

// ВСТАВЬТЕ ЭТО В SERVER.JS

function addComplexityDetails(prompt, sceneComplexity) {
    if (!sceneComplexity) return prompt;

    // Преобразование sceneComplexity в число
    const complexity = parseInt(sceneComplexity);
    
    if (complexity > 7) {
        prompt += ", ultra-detailed, 8k, trending on artstation";
    } else if (complexity > 5) {
        prompt += ", highly detailed, photorealistic";
    }
    return prompt;
}

//
// --- НАЧАЛО ЗАМЕНЫ ---
// Старая функция generatePromptHandler (строки 164-263) УДАЛЕНА
// и заменена этой новой версией.
//

const generatePromptHandler = async (req, res, next) => {
  try {
    const { idea, parameters, mode, operatingMode } = req.body;
    const modelName = parameters.generationModel || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({ model: modelName });
    logger.info(`Using model (Prompt): ${modelName}, Mode: ${mode}, OperatingMode: ${operatingMode}`);

    let systemInstruction; // Объявляем заранее

    // --- НОВАЯ ЛОГИКА С РАЗДЕЛЕНИЕМ ПРОМПТОВ ---

    if (mode === 'auto-pilot') {
        // --- СПЕЦИАЛЬНЫЙ ПРОМПТ ДЛЯ АВТОПИЛОТА ---
        systemInstruction = `
Вы — элитный AI-режиссер и эксперт по prompt engineering для Sora и Veo.
Ваша задача: полностью взять на себя творческое управление.
На основе базовой идеи пользователя, вы ДОЛЖНЫ:

1.  **Самостоятельно выбрать** ЛУЧШИЕ параметры (стиль, движение камеры, освещение, кинематография, настроение, эффекты, фон, аудио).
2.  **Игнорировать** любые параметры, которые мог прислать пользователь (кроме 'idea'). Ваше творческое видение в приоритете.
3.  **Создать** единый, богатый, профессиональный и детализированный промпт для видео.
4.  Интегрировать выбранные вами параметры в текст естественно, как описание сцены.
5.  Добавить 3-5 тегов качества (например, 8K, ultra-detailed, cinematic lighting).

ИСХОДНАЯ ИДЕЯ: "${idea}"

ПРИМЕР ВЫВОДА (для идеи "котенок спит"):
"A tiny, fluffy ginger kitten is curled up asleep on a sun-drenched windowsill, cinematic close-up shot, soft natural lighting creates a warm glow, peaceful mood, dust particles dance in the volumetric god-rays, 8K, photorealistic, extremely detailed fur."

ПРАВИЛА ВЫВОДА (Критично):
Ответ ДОЛЖЕН содержать ТОЛЬКО текст итогового промпта на русском языке. Никаких объяснений, предисловий, JSON или "служебного" текста.
`;

    } else if (mode === 'super-improve' || mode === 'improve') {
        // --- СТАНДАРТНЫЙ ПРОМПТ ДЛЯ 'improve' И 'super-improve' ---
        systemInstruction = `
Вы — эксперт по prompt engineering для видео-генераторов Sora и Veo. Ваша роль: превратить базовую идею и параметры в единый, профессиональный, детализированный промпт.

ИСХОДНЫЕ ДАННЫЕ:
Базовая идея: "${idea}"
Режим: ${mode === 'super-improve' ? 'Максимально детализировать с креативными метафорами' : 'Улучшить с акцентом на детали'}
Параметры: ${JSON.stringify(parameters, null, 2)}

ШАГИ ГЕНЕРАЦИИ:
1. Проанализируйте идею: разбейте на ключевые элементы (субъект, действие, окружение).
2. Интегрируйте параметры: ОБЯЗАТЕЛЬНО используйте все параметры, предоставленные пользователем. Добавьте их как фразы (например, "cinematic wide shot, volumetric lighting").
3. Добавьте креативность: для 'super-improve' используйте визуальные метафоры (например, "как в эпическом фильме Нолана").
4. Завершите секциями: если в параметрах есть "negative", "duration" или "audio", добавьте их в конце как отдельные строки с заголовками (например, "АУДИО: эпичная музыка").
5. Обеспечьте связность: промпт должен быть одним coherent текстом.

ПРАВИЛА ВЫВОДА (Критично)
6. Ответ ДОЛЖЕН содержать ТОЛЬКО текст итогового промпта на русском языке. Никаких объяснений, предисловий, JSON или "служебного" текста. 
`;
    } else {
        // Эта ветка не должна сработать из-за Joi, но это защита от ошибок
        logger.error(`Invalid mode received: ${mode}`);
        return res.status(400).json({ error: 'Invalid processing mode' });
    }

    const result = await model.generateContent(systemInstruction);
    let generatedPrompt = result.response.text().trim(); 

    // --- ОБЩАЯ ЛОГИКА ДЛЯ ВСЕХ РЕЖИМОВ (Применение доп. параметров) ---
    // (Автопилот уже может их включить, но мы добавим их на всякий случай, если он забудет)
    generatedPrompt = addComplexityDetails(generatedPrompt, parameters.sceneComplexity);
    generatedPrompt = applyIntensity(generatedPrompt, parameters.intensityLevels);

    const fogIntensity = parameters.fogIntensity;
    if (fogIntensity === 'slightly') {
        generatedPrompt += ', slightly foggy';
    } else if (fogIntensity === 'moderately') {
        generatedPrompt += ', moderately smoky';
    } else if (fogIntensity === 'extremely') {
        generatedPrompt += ', extremely dense fog';
    }

    // --- Логика "Режима Работы" ---
    if (operatingMode === 'no-names') {
        logger.info('Applying no-names filter...');
        // Валидация Joi уже пропустила эти поля, если они были
        const exceptions = req.body.noNamesExceptions || '';
        const exceptionsText = exceptions.length > 0 ? `КРОМЕ СЛЕДУЮЩИХ ИСКЛЮЧЕНИЙ: ${exceptions}` : '';
        const noNamesPrompt = `Перепиши промпт, избегая любых конкретных имен людей, брендов, персонажей или собственных названий. ${exceptionsText}. Заменяй их на детальные описательные фразы, которые точно передают уникальные черты, внешность, способности и роль оригинала, чтобы это оставалось узнаваемым как именно этот персонаж/объект, но без прямого упоминания имени. Сохрани весь оригинальный смысл, детали, сюжет и контекст. Не обобщай — делай описание специфичным.

Примеры:
- Вместо "Batman" — "темный рыцарь в черном плаще с ушами летучей мыши, борющийся с преступностью в готическом городе с помощью гаджетов".
- Вместо "Harry Potter" — "молодой волшебник с шрамом в форме молнии на лбу, носящий круглые очки, владеющий волшебной палочкой и сражающийся с темным лордом".
- Вместо "Coca-Cola" — "газированный напиток в красной бутылке с классическим вкусом колы, известный своим освежающим эффектом".

Отвечай только переписанным промптом, без объяснений.

Оригинал: "${generatedPrompt}"`;
       
        const noNamesResult = await model.generateContent(noNamesPrompt);
        generatedPrompt = noNamesResult.response.text().trim();

    } else if (operatingMode === 'base64') {
        const encoding = req.body.base64Encoding || 'base64';
        logger.info(`Applying ${encoding} filter...`);
        if (encoding === 'rot13') {
            generatedPrompt = generatedPrompt.replace(/[a-zA-Z]/g, function(c){
                return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
            });
        } else if (encoding === 'url') {
            generatedPrompt = encodeURIComponent(generatedPrompt);
        } else { // base64
            generatedPrompt = Buffer.from(generatedPrompt).toString('base64');
        }
    }
    // --- Конец логики "Режима Работы" ---

    res.json({ generatedPrompt });
    logger.info('Prompt generated successfully');
  } catch (error) {
    next(error);
  }
};

//
// --- КОНЕЦ ЗАМЕНЫ ---
//

// Обработчик /api/generate-tags (из V11)
const generateTagsHandler = async (req, res, next) => {
  try {
    const { idea, prompt, generationModel } = req.body;
    const modelName = generationModel || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({ model: modelName });
    logger.info(`Using model (Tags): ${modelName}`);

    const generationPrompt = `
Вы — ассистент по prompt engineering.
Идея: "${idea}"
Промпт: "${prompt}"

ЗАДАЧА: Предложите 5-7 уникальных тегов (через запятую), которых НЕТ в промпте, но которые улучшат его (например, "ray tracing, subsurface scattering"). Будьте креативны, но релевантны стилю.
ПРИМЕР: Для "кошка" — "fluffy fur, glowing eyes, whimsical pose".
ОТВЕТ: Только список тегов, без пояснений.
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
Вы — QA для видео-ИИ.
Промпт: "${prompt}"

ШАГИ: 1. Проанализируйте промпт на потенциальные артефакты (размытие, деформации). 2. Предложите 3-5 ключевых слов для негативного промпта.
ПРИМЕР: Для "человек в беге" — "deformed limbs, motion blur, poor proportions".
ОТВЕТ: Только список через запятую, без объяснений.
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
Вы — эксперт по негативным промптам для видео-ИИ.
Позитивный промпт: "${prompt}"

ЗАДАЧА: Сгенерируйте 5-10 ключевых слов (через запятую) для избежания ошибок, адаптированных к стилю (артефакты, деформации). Будьте specific.
ПРИМЕР: Для "футуристический город" — "overexposed, pixelated, unnatural colors, distorted buildings".
ОТВЕТ: Только список, без текста.
`;

        const result = await model.generateContent(generationPrompt);
        let generatedNegative = result.response.text().trim();

        if (clean) {
            const commonErrors = /\b(blurry|low quality|bad anatomy|deformed|watermark|text|signature|artifacts|poorly drawn|extra limbs|missing limbs|mutated|disfigured|out of frame|cropped)\b,? */gi;
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
        const prompt = `Переведи текст на английский, сохраняя технические термины (например, "cinematic" остается). Отвечай только переводом: "${text}"`;

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
                // Изменено на русский
                prompt = `Сгенерируй ОДНУ оригинальную идею для стиля/освещения видео. Одно предложение (до 55 слов), на русском. Пример: "Неоновое освещение в стиле киберпанк с динамичными тенями." Никаких списков.`;
                break;
            case 'quality':
                // Изменено на русский
                prompt = `Сгенерируй ОДНУ оригинальную идею для качества/разрешения видео. Одно предложение (до 45 слов), на русском. Пример: "Ультра-детализированное 8K с volumetric lighting и octane render." Никаких списков.`;
                break;
            default: // 'subject'
                // Изменено на русский
                prompt = `Сгенерируй ОДНУ оригинальную идею для объекта/сюжета видео. Одно предложение (до 35 слов), на русском. Пример: "Летающий дракон в древнем лесу, сражающийся с рыцарем." Никаких списков.`;
        }
        // **********************************************
        
        const result = await model.generateContent(prompt);
        const idea = result.response.text().trim();
        res.json({ idea });
        logger.info('Idea generated successfully');
    } catch (error) {
        next(error);
    }
};

const generateCustomPresetHandler = async (req, res, next) => {
    try {
        const { idea, generationModel } = req.body;
        const modelName = generationModel || 'gemini-2.5-flash';
        const model = genAI.getGenerativeModel({ model: modelName });
        logger.info(`Using model (Custom Preset): ${modelName}`);

        const prompt = `
            You are a creative assistant for a video prompt generator. Your task is to generate a complete preset based on a user's idea.
            The output MUST be a valid JSON object that matches this structure:
            {
              "style": "...",
              "camera": "...",
              "lighting": "...",
              "cinematography": "...",
              "mood": "...",
              "effect": "...",
              "background": "...",
              "audio": "...",
              "details": "...",
              "negative": "..."
            }
            Do not include any explanations, just the JSON object.
            User's idea: "${idea}"
        `;

        const result = await model.generateContent(prompt);
        const presetText = result.response.text().trim().replace(/```json/g, '').replace(/```/g, '');
        const preset = JSON.parse(presetText);
        res.json(preset);
        logger.info('Custom preset generated successfully');
    } catch (error) {
        next(error);
    }
};

const animeAutoFillHandler = async (req, res, next) => {
    try {
        const { title, generationModel } = req.body;
        const modelName = generationModel || 'gemini-2.5-flash';
        const model = genAI.getGenerativeModel({ model: modelName });
        logger.info(`Using model (Anime Auto-fill): ${modelName}`);

        const prompt = `
            Based on the anime title "${title}", provide the animation studio, the art style, and a prominent artist associated with it.
            The output MUST be a valid JSON object with "studio", "style", and "artist" keys.
            For example, for "Spirited Away", the output should be:
            {
              "studio": "Studio Ghibli",
              "style": "Hayao Miyazaki style, detailed background art",
              "artist": "Hayao Miyazaki"
            }
            Do not include any explanations, just the JSON object.
        `;

        const result = await model.generateContent(prompt);
        const autoFillText = result.response.text().trim().replace(/```json/g, '').replace(/```/g, '');
        const autoFill = JSON.parse(autoFillText);
        res.json(autoFill);
        logger.info('Anime auto-fill successful');
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
app.post('/api/generate-custom-preset', validate(customPresetSchema), generateCustomPresetHandler);
app.post('/api/anime-auto-fill', validate(animeAutoFillSchema), animeAutoFillHandler);

// --- Централизованная обработка ошибок (из V11) ---
app.use((err, req, res, next) => {
  logger.error(`Unhandled Error: ${err.message}`, { stack: err.stack, ip: req.ip });
  res.status(500).json({ error: 'Internal Server Error' });
});

// --- Запуск сервера ---
app.listen(port, () => {
  logger.info(`Production-ready server listening at http://localhost:${port}`);
});
