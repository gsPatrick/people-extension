// ARQUIVO COMPLETO: src/services/ai.service.js

import { OpenAI } from 'openai';
import { log, error as logError } from '../utils/logger.service.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Avalia um único critério com base em trechos relevantes de um perfil.
 * @param {object} criterion - O objeto do critério ({ name, description, weight }).
 *- @param {string[]} relevantChunks - Os trechos de texto mais relevantes do perfil.
 * @returns {Promise<{ name: string, score: number, justification: string }>} A avaliação da IA.
 */
export const analyzeCriterionWithAI = async (criterion, relevantChunks) => {
  if (!process.env.OPENAI_API_KEY) {
      logError("Chave da API da OpenAI não configurada no .env");
      throw new Error("Chave da API da OpenAI não configurada.");
  }

  // Se a busca vetorial não retornou evidências, podemos concluir rapidamente.
  if (!relevantChunks || relevantChunks.length === 0) {
      return {
          name: criterion.name,
          score: 1, // Nota mínima por falta de evidência
          justification: "Nenhuma evidência relevante foi encontrada no perfil para este critério."
      };
  }

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
      // gpt-4o-mini é rápido, inteligente e tem bom custo-benefício para tarefas focadas.
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1, // Baixa temperatura para respostas mais factuais e consistentes.
    });
    
    const content = response.choices[0].message.content;
    const result = JSON.parse(content);

    // Validação mínima para garantir que o resultado tenha a estrutura esperada.
    if (typeof result.score !== 'number' || typeof result.justification !== 'string') {
        throw new Error("A resposta da IA não continha os campos 'score' e 'justification' esperados.");
    }

    return {
      name: criterion.name,
      score: result.score,
      justification: result.justification,
    };

  } catch (err) {
    logError(`Falha na avaliação do critério "${criterion.name}" pela IA:`, err.message);
    // Retorna uma falha "graceful" para não quebrar todo o processo de match.
    return {
      name: criterion.name,
      score: 1,
      justification: "Ocorreu um erro interno ao tentar analisar este critério com a IA.",
    };
  }
};