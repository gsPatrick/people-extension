// src/services/ai.service.js
import { OpenAI } from 'openai';
import { log, error as logError } from '../utils/logger.service.js';

const openai = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 100000,
    maxRetries: 2
});

const analyzeCriterionWithGPT = async (criterion, relevantChunks) => {
    if (!relevantChunks || relevantChunks.length === 0) {
        return {
            name: criterion.name,
            score: 1,
            justification: "Nenhuma evidência relevante encontrada."
        };
    }

    const limitedChunks = relevantChunks.slice(0, 3);
    const prompt = `Avalie o critério: "${criterion.name}"

EVIDÊNCIAS:
${limitedChunks.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Responda em JSON: {"score": <1-5>, "justification": "<frase curta>"}
Escala: 1=sem evidência, 3=parcial, 5=forte`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0,
            max_tokens: 150
        });

        const result = JSON.parse(response.choices[0].message.content);
        return {
            name: criterion.name,
            score: result.score || 1,
            justification: result.justification || "Análise incompleta"
        };
    } catch (err) {
        logError(`Erro ao avaliar "${criterion.name}":`, err.message);
        return {
            name: criterion.name,
            score: 1,
            justification: "Erro na análise"
        };
    }
};

// Análise individual (compatibilidade)
export const analyzeCriterionWithAI = async (criterion, relevantChunks) => {
    return analyzeCriterionWithGPT(criterion, relevantChunks);
};

// 🚀 BATCH: 1 chamada para todos os critérios
export const analyzeAllCriteriaInBatch = async (criteriaWithChunks) => {
    const startTime = Date.now();
    log(`Análise em BATCH de ${criteriaWithChunks.length} critérios...`);

    const batchPrompt = `Avalie cada critério baseado nas evidências:

${criteriaWithChunks.map(({ criterion, chunks }, idx) => `
CRITÉRIO ${idx + 1}: "${criterion.name}"
EVIDÊNCIAS: ${chunks.slice(0, 2).join(' | ') || 'Nenhuma'}
`).join('\n')}

Responda com array JSON:
[{"name": "nome", "score": 1-5, "justification": "breve"}, ...]

Escala: 1=sem evidência, 3=parcial, 5=forte`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: batchPrompt }],
            response_format: { type: "json_object" },
            temperature: 0,
            max_tokens: 1500
        });

        const content = response.choices[0].message.content;
        const parsed = JSON.parse(content);
        const results = Array.isArray(parsed) ? parsed : (parsed.results || parsed.evaluations || []);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        log(`✓ BATCH concluído em ${duration}s`);

        return results;
    } catch (err) {
        logError('Erro no batch, usando paralelo:', err.message);
        return Promise.all(
            criteriaWithChunks.map(({ criterion, chunks }) => 
                analyzeCriterionWithGPT(criterion, chunks)
            )
        );
    }
};