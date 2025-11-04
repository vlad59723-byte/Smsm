
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const winston = require('winston');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config({ path: __dirname + '/.env' });

const app = express();
const port = 3000;

// Winston logger setup
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    defaultMeta: { service: 'user-service' },
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
    ],
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple(),
    }));
}

// Security and Performance Middleware
app.use(cors());
app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(express.static(__dirname));


// Rate Limiting
const rateLimiter = new RateLimiterMemory({
    points: 10, // 10 requests
    duration: 1, // per 1 second by IP
});

const rateLimiterMiddleware = (req, res, next) => {
    rateLimiter.consume(req.ip)
        .then(() => {
            next();
        })
        .catch(() => {
            res.status(429).send('Too Many Requests');
        });
};

app.use(rateLimiterMiddleware);

// Google Generative AI setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// API Endpoints
app.post('/api/generate-prompt', async (req, res) => {
    const { idea, parameters, mode } = req.body;
    const { generationModel } = parameters;
    const model = genAI.getGenerativeModel({ model: generationModel });

    let prompt = `Generate a detailed prompt for a video generation AI. The user's idea is: "${idea}".`;

    if (parameters) {
        prompt += " The following parameters are provided:\n";
        for (const [key, value] of Object.entries(parameters)) {
            if (value) {
                prompt += `- ${key}: ${value}\n`;
            }
        }
    }

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let generatedPrompt = response.text();

        // Apply operating mode
        if (mode === 'no-names') {
            const noNamesPrompt = `Rewrite the following prompt to avoid using any specific names of people, brands, or characters. Instead, use descriptive language. For example, instead of "Harry Potter", you could say "a young wizard with a lightning scar".\n\nOriginal prompt: "${generatedPrompt}"`;
            const noNamesResult = await model.generateContent(noNamesPrompt);
            const noNamesResponse = await noNamesResult.response;
            generatedPrompt = noNamesResponse.text();
        } else if (mode === 'base64') {
            // This is a simplified version. A real implementation would use a library or a more complex regex.
            generatedPrompt = generatedPrompt.replace(/Harry Potter/gi, btoa('Harry Potter'));
        }

        res.json({ generatedPrompt });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ error: 'Failed to generate prompt' });
    }
});

app.post('/api/translate', async (req, res) => {
    const { text, generationModel } = req.body;
    const model = genAI.getGenerativeModel({ model: generationModel });
    const prompt = `Translate the following text to English: "${text}"`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const translatedText = response.text();
        res.json({ translatedText });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ error: 'Failed to translate text' });
    }
});

app.post('/api/generate-ideas', async (req, res) => {
    const { generationModel } = req.body;
    const model = genAI.getGenerativeModel({ model: generationModel });
    const prompt = `Generate a creative and interesting idea for a video.`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const idea = response.text();
        res.json({ idea });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ error: 'Failed to generate ideas' });
    }
});

app.listen(port, () => {
    logger.info(`Server is running on http://localhost:${port}`);
});
