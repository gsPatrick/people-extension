// ARQUIVO COMPLETO E ATUALIZADO: src/services/ai.service.js

import { OpenAI } from 'openai';
import axios from 'axios'; // Precisamos do Axios para chamadas locais
import { log, error as logError } from '../utils/logger.service.js';

// Configuração do cliente OpenAI (continua aqui para fallback)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Função para analisar um critério usando um LLM local via Ollama.
 */
const analyzeCriterionWithLocalAI = async (criterion, relevantChunks) => {
    const prompt = `
      Você é um Recrutador Sênior especialista. Avalie um critério com base em evidências de um perfil.

      **CRITÉRIO:** "${criterion.name}"

      **EVIDÊNCIAS:**
      ${relevantChunks.map(c => `- "${c}"`).join('\n')}

      **ANÁLISE:**
      1.  Atribua uma nota de 1 a 5 (1: Nenhuma evidência, 3: Evidência fraca, 5: Evidência forte).
      2.  Escreva uma justificativa curta e objetiva (1 frase).

      **Formato OBRIGATÓRIO da Resposta (APENAS JSON):**
      {
        "score": <sua nota de 1 a 5>,
        "justification": "<sua justificativa>"
      }
    `;

    try {
        log(`Analisando critério "${criterion.name}" com LLM local (${process.env.LOCAL_LLM_MODEL})...`);
        
        const response = await axios.post(
            `${process.env.OLLAMA_API_URL}/api/chat`, 
            {
                model: process.env.LOCAL_LLM_MODEL,
                messages: [{ role: "user", content: prompt }],
                format: "json", // Magia do Ollama para forçar a saída em JSON
                stream: false   // Garante que receberemos a resposta completa de uma vez
            },
            {
                headers: { 'Content-Type': 'application/json' }
            }
        );

        // O Ollama retorna o JSON como uma string dentro de `message.content`
        const result = JSON.parse(response.data.message.content);

        if (typeof result.score !== 'number' || typeof result.justification !== 'string') {
            throw new Error("A resposta do LLM local não tem o formato JSON esperado.");
        }

        return {
            name: criterion.name,
            score: result.score,
            justification: result.justification,
        };

    } catch (err) {
        logError(`Falha na avaliação do critério "${criterion.name}" com o LLM local:`, err.response?.data?.error || err.message);
        return {
            name: criterion.name,
            score: 1,
            justification: "Ocorreu um erro interno ao tentar analisar este critério com a IA local.",
        };
    }
};

/**
 * Função para analisar um critério usando a API da OpenAI (versão original).
 */
const analyzeCriterionWithOpenAI = async (criterion, relevantChunks) => {
    const prompt = `
      Você é um Recrutador Sênior especialista em triagem de candidatos.
      Sua tarefa é avaliar um único critério de uma vaga com base em trechos específicos de um perfil do LinkedIn.

      **CRITÉRIO A SER AVALIADO:**
      - Nome: "${criterion.name}"

      **EVIDÊNCIAS (Trechos do perfil mais relevantes para este critério):**
      ${relevantChunks.map(c => `- "${c}"`).join('\n')}

      **SUA ANÁLISE:**
      1.  Com base SOMENTE nas evidências fornecidas, atribua uma nota de 1 a 5, onde:
          1: Nenhuma evidência ou evidência contrária.
          3: Evidência indireta ou fraca.
          5: Evidência forte e direta que atende ao critério.
      2.  Escreva uma justificativa curta e objetiva (idealmente 1 frase, máximo 2) que explique o porquê da sua nota, citando a evidência.

      **Formato OBRIGATÓRIO da Resposta (APENAS JSON, sem texto adicional):**
      {
        "score": <sua nota de 1 a 5>,
        "justification": "<sua justificativa objetiva>"
      }
    `;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0.1,
        });
        const result = JSON.parse(response.choices[0].message.content);
        if (typeof result.score !== 'number' || typeof result.justification !== 'string') {
            throw new Error("A resposta da IA não continha os campos 'score' e 'justification' esperados.");
        }
        return {
            name: criterion.name,
            score: result.score,
            justification: result.justification,
        };
    } catch (err) {
        logError(`Falha na avaliação do critério "${criterion.name}" pela OpenAI:`, err.message);
        return {
            name: criterion.name,
            score: 1,
            justification: "Ocorreu um erro interno ao tentar analisar este critério com a OpenAI.",
        };
    }
};

/**
 * FUNÇÃO PRINCIPAL: Decide qual motor de IA usar com base nas variáveis de ambiente.
 */
export const analyzeCriterionWithAI = async (criterion, relevantChunks) => {
    // Se não houver evidências, retorna rapidamente sem chamar a IA.
    if (!relevantChunks || relevantChunks.length === 0) {
        return {
            name: criterion.name,
            score: 1,
            justification: "Nenhuma evidência relevante foi encontrada no perfil para este critério."
        };
    }

    // Verifica a variável de ambiente para decidir qual função chamar.
    if (process.env.USE_LOCAL_LLM === 'true') {
        if (!process.env.OLLAMA_API_URL || !process.env.LOCAL_LLM_MODEL) {
            logError("Variáveis de ambiente para LLM local (OLLAMA_API_URL, LOCAL_LLM_MODEL) não configuradas.");
            throw new Error("LLM local habilitado, mas não configurado corretamente no .env");
        }
        return analyzeCriterionWithLocalAI(criterion, relevantChunks);
    } else {
        if (!process.env.OPENAI_API_KEY) {
            logError("Chave da API da OpenAI não configurada no .env");
            throw new Error("Chave da API da OpenAI não configurada.");
        }
        return analyzeCriterionWithOpenAI(criterion, relevantChunks);
    }
};