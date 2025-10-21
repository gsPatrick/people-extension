import { OpenAI } from 'openai';
import { log, error } from '../utils/logger.service.js';

// Configura o cliente da OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Modelo de embedding otimizado para performance e custo
const EMBEDDING_MODEL = 'text-embedding-3-small'; 
// Este modelo da OpenAI é mais novo, mais barato e mais performático que o 'ada-002'.
// Sua dimensão é 1536, então o tipo VECTOR(1536) no model está correto.

/**
 * Converte um único texto ou um array de textos em vetores (embeddings).
 * @param {string|string[]} texts - O texto ou textos a serem convertidos.
 * @returns {Promise<number[][]>} Um array de vetores.
 */
export const createEmbeddings = async (texts) => {
  // Garante que a entrada seja sempre um array para a API
  const inputText = Array.isArray(texts) ? texts : [texts];

  // Filtra textos vazios para não gastar chamadas de API
  const validTexts = inputText.filter(t => t && typeof t === 'string' && t.trim() !== '');
  if (validTexts.length === 0) {
    return [];
  }

  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: validTexts,
    });

    // Retorna apenas o array de vetores
    return response.data.map(item => item.embedding);
  } catch (err) {
    error('Falha ao criar embeddings com a API da OpenAI:', err.message);
    // Lançar o erro permite que o serviço que chamou decida como lidar com a falha
    throw new Error('Falha na geração de embeddings.');
  }
};