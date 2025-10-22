// ARQUIVO COMPLETO E ATUALIZADO: src/services/ai.service.js

import { OpenAI } from 'openai';
import { log, error as logError } from '../utils/logger.service.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Avalia um único critério com base em trechos relevantes de um perfil.
 * @param {object} criterion - O objeto do critério ({ name, description, weight }).
 * @param {string[]} relevantChunks - Os trechos de texto mais relevantes do perfil.
 * @returns {Promise<{ name: string, score: number, justification: string }>} A avaliação da IA.
 */
export const analyzeCriterionWithAI = async (criterion, relevantChunks) => {
  if (!process.env.OPENAI_API_KEY) throw new Error("Chave da API da OpenAI não configurada.");

  // Se não houver chunks relevantes, não há o que analisar.
  if (!relevantChunks || relevantChunks.length === 0) {
      return {
          name: criterion.name,
          score: 1,
          justification: "Nenhuma evidência encontrada no perfil para este critério."
      };
  }

  const prompt = `
    Você é um Recrutador Sênior especialista. Sua tarefa é avaliar um único critério com base em trechos de um perfil.

    **CRITÉRIO A SER AVALIADO:**
    - Nome: "${criterion.name}"

    **EVIDÊNCIAS (Trechos relevantes do perfil):**
    ${relevantChunks.map(c => `- ${c}`).join('\n')}

    **SUA ANÁLISE:**
    1. Baseado SOMENTE nas evidências fornecidas, atribua uma nota de 1 a 5 (1 = nenhuma evidência, 5 = evidência forte).
    2. Escreva uma justificativa curta e objetiva (1 frase) para a sua nota.

    **Formato OBRIGATÓRIO da Resposta (APENAS JSON):**
    {
      "score": <sua nota de 1 a 5>,
      "justification": "<sua justificativa objetiva>"
    }
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Continua sendo uma ótima escolha para tarefas focadas
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });
    
    const result = JSON.parse(response.choices[0].message.content);

    return {
      name: criterion.name,
      score: result.score || 1,
      justification: result.justification || "Não foi possível gerar uma justificativa.",
    };
  } catch (err) {
    logError(`Falha na avaliação do critério "${criterion.name}" pela IA:`, err.message);
    return {
      name: criterion.name,
      score: 1,
      justification: "Ocorreu um erro ao analisar este critério com a IA.",
    };
  }
};