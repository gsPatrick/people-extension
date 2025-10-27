// ARQUIVO ATUALIZADO: src/services/ai.service.js

import { OpenAI } from 'openai';
import { log, error as logError } from '../utils/logger.service.js';

const openai = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 100000, // Timeout aumentado
    maxRetries: 2
});

// Esta função é otimizada para ser rápida e confiável em uma única tarefa.
const analyzeCriterionWithGPT = async (criterion, relevantChunks) => {
    if (!relevantChunks || relevantChunks.length === 0) {
        return {
            name: criterion.name,
            score: 1,
            justification: "Nenhuma evidência relevante encontrada."
        };
    }

    // Limitamos os chunks para manter o prompt enxuto e rápido.
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

// MUDANÇA 1: Tornamos a execução em paralelo o método principal.
// A abordagem em lote (batch) provou ser muito lenta para o requisito de < 5 segundos.
export const analyzeAllCriteriaInBatch = async (criteriaWithChunks) => {
    const startTime = Date.now();
    log(`Análise em PARALELO de ${criteriaWithChunks.length} critérios...`);

    try {
        // Dispara todas as requisições de análise individual ao mesmo tempo.
        const allPromises = criteriaWithChunks.map(({ criterion, chunks }) => 
            analyzeCriterionWithGPT(criterion, chunks)
        );

        // Aguarda a conclusão de todas as promessas.
        const results = await Promise.all(allPromises);
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        log(`✓ Análise em PARALELO concluída em ${duration}s. Todas as ${results.length} avaliações recebidas.`);

        return results;

    } catch (err) {
        logError('Erro crítico durante a análise em paralelo:', err.message);
        // Retorna um array de erros para que o fluxo não quebre completamente
        return criteriaWithChunks.map(({ criterion }) => ({
            name: criterion.name,
            score: 1,
            justification: "Falha geral na análise paralela"
        }));
    }
};