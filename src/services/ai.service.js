// ARQUIVO COMPLETO E FINAL: src/services/ai.service.js

import { OpenAI } from 'openai';
import { log, error as logError } from '../utils/logger.service.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Analisa um scorecard completo, usando um mapa de evidências pré-filtradas, em uma única chamada de IA.
 * @param {object} scorecard - O objeto completo do scorecard.
 * @param {Map<string, string[]>} evidenceMap - Mapa onde a chave é o nome do critério e o valor é um array de chunks de texto.
 * @returns {Promise<object>} O resultado da análise no formato esperado.
 */
export const analyzeWithPreFilteredEvidence = async (scorecard, evidenceMap) => {
  if (!process.env.OPENAI_API_KEY) throw new Error("Chave da API da OpenAI não configurada.");

  // Prepara os dados para o prompt
  const analysisData = scorecard.categories.map(category => ({
      name: category.name,
      criteria: (category.criteria || []).map(criterion => ({
          name: criterion.name,
          evidence: evidenceMap.get(criterion.name) || ["Nenhuma evidência direta encontrada pela busca vetorial."]
      }))
  }));

  const jsonStructure = {
    overallScore: "number (0-100)",
    categories: [ { name: "string", criteria: [ { name: "string", score: "number (1-5)", justification: "string" } ] } ]
  };

  const prompt = `
    Você é um Recrutador Sênior especialista. Sua tarefa é avaliar um candidato contra um scorecard.
    Para cada critério do scorecard, eu já encontrei as evidências mais relevantes no perfil do candidato.

    **TAREFA:**
    Analise o conjunto de critérios e evidências abaixo. Para CADA critério, atribua uma nota de 1 a 5 e escreva uma justificativa curta.
    Se a evidência for "Nenhuma evidência...", a nota deve ser 1.
    Finalmente, calcule um "Overall Score" de 0 a 100 para o candidato.

    **CRITÉRIOS E EVIDÊNCIAS:**
    ${JSON.stringify(analysisData, null, 2)}

    **INSTRUÇÕES DE SAÍDA:**
    Responda APENAS com um objeto JSON. Não inclua nenhum texto ou formatação fora do JSON.
    Siga ESTRITAMENTE a estrutura abaixo.

    **ESTRUTURA JSON OBRIGATÓRIA:**
    ${JSON.stringify(jsonStructure, null, 2)}
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });
    
    const content = response.choices[0].message.content;
    return JSON.parse(content);

  } catch (err) {
    logError(`Falha na análise 'Single-Shot com Evidências':`, err.message);
    throw new Error('Ocorreu um erro ao processar a análise final com a IA.');
  }
};