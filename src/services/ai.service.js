
import { OpenAI } from 'openai';
import { log, error as logError } from '../utils/logger.service.js';
import _ from 'lodash';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Remove campos desnecessários do perfil para economizar tokens.
 * @param {object} profileData - Os dados brutos do perfil.
 * @returns {object} O perfil simplificado.
 */
const simplifyProfileForAI = (profileData) => {
    return _.pick(profileData, [
        'name', 'headline', 'about', 'experience', 
        'education', 'skills', 'certifications', 'languages'
    ]);
};

/**
 * Analisa o perfil completo contra o scorecard completo em uma única chamada de IA.
 * @param {object} scorecard - O objeto completo do scorecard.
 * @param {object} profileData - Os dados do perfil do candidato.
 * @returns {Promise<object>} O resultado da análise no formato esperado.
 */
export const analyzeProfileHolistically = async (scorecard, profileData) => {
  if (!process.env.OPENAI_API_KEY) throw new Error("Chave da API da OpenAI não configurada.");

  const simplifiedProfile = simplifyProfileForAI(profileData);

  const jsonStructure = {
    overallScore: "number (0-100)",
    categories: [
      {
        name: "string",
        criteria: [
          {
            name: "string",
            score: "number (1-5)",
            justification: "string (justificativa curta e objetiva)"
          }
        ]
      }
    ]
  };

  const prompt = `
    Você é um Recrutador Sênior especialista em análise de perfis para vagas de tecnologia.
    Sua tarefa é avaliar um perfil completo de um candidato contra um scorecard completo.

    **PERFIL DO CANDIDATO:**
    ${JSON.stringify(simplifiedProfile, null, 2)}

    **SCORECARD (CRITÉRIOS DE AVALIAÇÃO):**
    ${JSON.stringify(scorecard.categories.map(c => ({ name: c.name, criteria: c.criteria.map(cr => cr.name) })), null, 2)}

    **INSTRUÇÕES DETALHADAS:**
    1.  Analise CADA critério listado no scorecard, usando o perfil do candidato como evidência.
    2.  Para cada critério, atribua uma nota de 1 a 5 (1 = nenhuma evidência, 5 = evidência forte e direta).
    3.  Para cada critério, escreva uma justificativa curta e objetiva (1-2 frases) para a sua nota, baseada nas evidências do perfil.
    4.  Calcule um "Overall Score" de 0 a 100, representando o quão bem o candidato se alinha com o scorecard como um todo.
    5.  Responda APENAS com um objeto JSON. Não inclua nenhum texto, explicação ou formatação markdown antes ou depois do JSON.

    **ESTRUTURA OBRIGATÓRIA DO JSON DE SAÍDA:**
    ${JSON.stringify(jsonStructure, null, 2)}
  `;

  try {
    const response = await openai.chat.completions.create({
      // gpt-4o-mini é rápido, inteligente e mais barato que o gpt-4-turbo
      model: "gpt-4o-mini", 
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1, // Quase determinístico para consistência
    });
    
    const content = response.choices[0].message.content;
    const result = JSON.parse(content);

    // Validação básica para garantir que a IA seguiu a estrutura
    if (!result.overallScore || !Array.isArray(result.categories)) {
        throw new Error("A resposta da IA não seguiu a estrutura JSON esperada.");
    }
    
    return {
      ...result,
      profileName: profileData.name,
      profileHeadline: profileData.headline
    };

  } catch (err) {
    logError(`Falha na análise holística pela IA:`, err.message);
    throw new Error('Ocorreu um erro ao processar a análise com a IA.');
  }
};