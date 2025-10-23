// ARQUIVO COMPLETO "APENAS OLLAMA": src/services/ai.service.js

import axios from 'axios';
import { log, error as logError } from '../utils/logger.service.js';

/**
 * FUNÇÃO PRINCIPAL: Avalia um critério usando EXCLUSIVAMENTE um LLM local via Ollama.
 * Sem fallback para a OpenAI.
 * @param {object} criterion - O objeto do critério ({ name, description, weight }).
 *- @param {string[]} relevantChunks - Os trechos de texto mais relevantes do perfil.
 * @returns {Promise<{ name: string, score: number, justification: string }>} A avaliação da IA.
 */
export const analyzeCriterionWithAI = async (criterion, relevantChunks) => {
    // 1. Verificação inicial de configuração
    if (process.env.USE_LOCAL_LLM !== 'true') {
        const errorMsg = "O serviço de IA está configurado para usar apenas o LLM local, mas a variável de ambiente USE_LOCAL_LLM não está definida como 'true' no arquivo .env.";
        logError(errorMsg);
        // Retorna uma resposta de erro para não quebrar a aplicação inteira
        return {
            name: criterion.name,
            score: 1,
            justification: "Erro de configuração: O modo LLM local não está ativado no servidor.",
        };
    }

    if (!process.env.OLLAMA_API_URL || !process.env.LOCAL_LLM_MODEL) {
        logError("Variáveis de ambiente para LLM local (OLLAMA_API_URL, LOCAL_LLM_MODEL) não configuradas.");
        return {
            name: criterion.name,
            score: 1,
            justification: "Erro de configuração: A URL do Ollama ou o nome do modelo não foram definidos no servidor.",
        };
    }
    
    // 2. Se não houver evidências, retorna rapidamente sem chamar a IA.
    if (!relevantChunks || relevantChunks.length === 0) {
        return {
            name: criterion.name,
            score: 1, // Nota mínima por falta de evidência
            justification: "Nenhuma evidência relevante foi encontrada no perfil para este critério."
        };
    }
    
    // 3. Montagem do Prompt (simplificado para Llama3)
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

    // 4. Chamada para a API do Ollama
    try {
        log(`[MODO LOCAL ATIVO] Analisando critério "${criterion.name}" com ${process.env.LOCAL_LLM_MODEL} em ${process.env.OLLAMA_API_URL}...`);
        
        const response = await axios.post(
            `${process.env.OLLAMA_API_URL}/api/chat`, 
            {
                model: process.env.LOCAL_LLM_MODEL,
                messages: [{ role: "user", content: prompt }],
                format: "json",
                stream: false
            },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000 // Timeout de 15 segundos para evitar que a requisição fique presa
            }
        );

        const result = JSON.parse(response.data.message.content);

        if (typeof result.score !== 'number' || typeof result.justification !== 'string') {
            throw new Error("A resposta do LLM local não tem o formato JSON esperado.");
        }

        log(`[SUCESSO LOCAL] Resposta recebida para "${criterion.name}".`);

        return {
            name: criterion.name,
            score: result.score,
            justification: result.justification,
        };

    } catch (err) {
        // Log de erro muito mais detalhado
        let detailedError = err.message;
        if (err.response) {
            // Erro vindo da API do Ollama (ex: modelo não encontrado)
            detailedError = `Erro da API Ollama: ${err.response.status} - ${JSON.stringify(err.response.data)}`;
        } else if (err.request) {
            // A requisição foi feita mas não houve resposta (ex: Ollama desligado ou URL errada)
            detailedError = `Não foi possível conectar ao servidor Ollama em ${process.env.OLLAMA_API_URL}. Verifique se o serviço está rodando e a URL está correta.`;
        }
        
        logError(`[FALHA LOCAL] Falha na avaliação do critério "${criterion.name}":`, detailedError);

        return {
            name: criterion.name,
            score: 1,
            justification: `Ocorreu um erro interno ao tentar analisar com a IA local: ${detailedError}`,
        };
    }
};