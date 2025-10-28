// ARQUIVO ATUALIZADO: src/services/ai.service.js

import { OpenAI } from 'openai';
import { log, error as logError } from '../utils/logger.service.js';

const openai = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 100000, // Timeout aumentado
    maxRetries: 2
});

// ==========================================================
// MUDANÇA PRINCIPAL APLICADA AQUI
// Esta função foi atualizada com um prompt muito mais rigoroso.
// ==========================================================
const analyzeCriterionWithGPT = async (criterion, relevantChunks) => {
    if (!relevantChunks || relevantChunks.length === 0) {
        return {
            name: criterion.name,
            score: 1, // A nota padrão para ausência de evidência é 1.
            justification: "Nenhuma evidência relevante encontrada no perfil."
        };
    }

    const limitedChunks = relevantChunks.slice(0, 3);
    
    // NOVO PROMPT: Personalidade Cética e Rubrica Rigorosa
    const prompt = `
        **Persona:** Você é um Tech Recruiter Sênior extremamente cético e rigoroso. Sua função é proteger a empresa de contratações ruins, exigindo provas claras e inequívocas no perfil do candidato.

        **Tarefa:** Avalie se as evidências abaixo, extraídas do perfil de um candidato, comprovam o critério de avaliação completo.
        
        **Critério Completo (avalie palavra por palavra):**
        "${criterion.name}"

        **Evidências Encontradas no Perfil:**
        ${limitedChunks.map((c, i) => `EVIDÊNCIA ${i + 1}: ${c}`).join('\n---\n')}

        **Rubrica de Avaliação (SEJA RIGOROSO):**
        -   **5 (Excepcional):** A evidência comprova o critério de forma explícita, direta e repetida. É inegável e impressionante.
        -   **4 (Forte):** A evidência é clara e direta, mas talvez em uma única menção forte.
        -   **3 (Parcial):** A evidência sugere o critério, mas não o comprova diretamente. Requer inferência. O candidato tangencia o ponto.
        -   **2 (Fraco):** A evidência é apenas vagamente relacionada. É uma suposição muito fraca.
        -   **1 (Inexistente):** **NÃO SEJA OTIMISTA.** Se não há prova clara e direta, a nota é 1. Na dúvida, a nota é 1. A ausência de evidência resulta em nota 1.

        **Formato da Resposta:**
        Responda APENAS com um objeto JSON, sem nenhum texto adicional.
        {"score": <sua nota de 1 a 5>, "justification": "<sua justificativa curta e direta>"}
    `;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0, // Temperatura 0 para respostas mais factuais e menos criativas.
            max_tokens: 150
        });

        const result = JSON.parse(response.choices[0].message.content);
        return {
            name: criterion.name,
            score: result.score || 1,
            justification: result.justification || "Análise incompleta"
        };
    } catch (err) {
        logError(`Erro ao avaliar (com prompt rigoroso) "${criterion.name}":`, err.message);
        return {
            name: criterion.name,
            score: 1,
            justification: "Erro na análise da IA"
        };
    }
};

// A função de execução em lote permanece a mesma, pois a performance é mantida.
export const analyzeAllCriteriaInBatch = async (criteriaWithChunks) => {
    const startTime = Date.now();
    log(`Análise em PARALELO de ${criteriaWithChunks.length} critérios (com prompt rigoroso)...`);

    try {
        const allPromises = criteriaWithChunks.map(({ criterion, chunks }) => 
            analyzeCriterionWithGPT(criterion, chunks)
        );

        const results = await Promise.all(allPromises);
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        log(`✓ Análise em PARALELO (rigorosa) concluída em ${duration}s. Todas as ${results.length} avaliações recebidas.`);

        return results;

    } catch (err) {
        logError('Erro crítico durante a análise em paralelo (rigorosa):', err.message);
        return criteriaWithChunks.map(({ criterion }) => ({
            name: criterion.name,
            score: 1,
            justification: "Falha geral na análise paralela"
        }));
    }
};