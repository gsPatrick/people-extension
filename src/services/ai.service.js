import { OpenAI } from 'openai';
import { log, error } from '../utils/logger.service.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Avalia um único critério com base em trechos relevantes de um perfil.
 * @param {object} criterion - O objeto do critério ({ name, description, weight }).
 * @param {string[]} relevantChunks - Os trechos de texto mais relevantes do perfil.
 * @returns {Promise<{ name: string, score: number, justification: string }>} A avaliação da IA.
 */
export const analyzeCriterionWithAI = async (criterion, relevantChunks) => {
  if (!process.env.OPENAI_API_KEY) throw new Error("Chave da API da OpenAI não configurada.");

  const prompt = `
    Você é um Recrutador Sênior especialista em análise de perfis.
    Sua tarefa é avaliar um único critério com base em trechos de um perfil do LinkedIn.

    **CRITÉRIO A SER AVALIADO:**
    - Nome: "${criterion.name}"
    - Descrição/Instrução: "${criterion.description || 'Avalie a competência ou experiência relacionada ao nome do critério.'}"
    - Peso/Importância: ${criterion.weight} (1=Baixo, 2=Médio, 3=Alto)

    **EVIDÊNCIAS (Trechos mais relevantes do perfil):**
    ${relevantChunks.map(c => `- ${c}`).join('\n')}

    **SUA ANÁLISE:**
    1. Leia o critério e as evidências.
    2. Atribua uma nota de 1 a 5, onde 1 é nenhuma evidência e 5 é evidência forte e direta.
    3. Escreva uma justificativa curta e objetiva (1 frase) explicando o porquê da sua nota, citando as evidências.

    **Formato OBRIGATÓRIO da Resposta (APENAS JSON):**
    {
      "score": <sua nota de 1 a 5>,
      "justification": "<sua justificativa objetiva>"
    }
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Um modelo mais rápido é ideal para esta tarefa focada
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2, // Baixa temperatura para respostas mais factuais
    });
    
    const result = JSON.parse(response.choices[0].message.content);

    return {
      name: criterion.name,
      score: result.score || 1,
      justification: result.justification || "Não foi possível gerar uma justificativa.",
    };
  } catch (err) {
    error(`Falha na avaliação do critério "${criterion.name}" pela IA:`, err.message);
    // Retorna uma falha gracefully para não quebrar todo o processo de match
    return {
      name: criterion.name,
      score: 1,
      justification: "Ocorreu um erro ao analisar este critério com a IA.",
    };
  }
};