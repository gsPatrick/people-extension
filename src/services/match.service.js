import { findById as findScorecardById } from './scorecard.service.js';
import { createEmbeddings } from './embedding.service.js';
import { analyzeCriterionWithAI } from './ai.service.js';
import { log, error } from '../utils/logger.service.js';
import db from '../models/index.js';

const { sequelize } = db;

// Função auxiliar para converter um vetor em um Buffer para o SQLite
const vectorToBuffer = (vector) => {
  if (!vector) return null;
  const float32Array = new Float32Array(vector);
  return Buffer.from(float32Array.buffer);
};

// Função auxiliar para dividir o perfil em pedaços de texto
const chunkProfile = (profileData) => {
  const chunks = [];
  if (profileData.headline) chunks.push(`Título: ${profileData.headline}`);
  if (profileData.about) chunks.push(`Sobre: ${profileData.about}`);
  if (profileData.skills?.length) chunks.push(`Competências: ${profileData.skills.join(', ')}`);
  if (profileData.experience) {
    profileData.experience.forEach(exp => {
      chunks.push(`Experiência: ${exp.title} na ${exp.companyName}. ${exp.description || ''}`);
    });
  }
  return chunks.filter(Boolean);
};

/**
 * Realiza a análise de match de um perfil contra um scorecard.
 * @param {string} scorecardId - O ID do scorecard.
 * @param {object} profileData - Os dados do perfil do LinkedIn.
 * @returns {Promise<object>} O resultado da análise.
 */
export const analyze = async (scorecardId, profileData) => {
  const startTime = Date.now();
  log(`Iniciando análise HÍBRIDA (SQLite-VSS) para "${profileData.name}"`);

  try {
    const scorecard = await findScorecardById(scorecardId);
    if (!scorecard) {
        const notFoundError = new Error('Scorecard não encontrado.');
        notFoundError.statusCode = 404;
        throw notFoundError;
    }

    const profileChunks = chunkProfile(profileData);
    if (profileChunks.length === 0) {
        const badRequestError = new Error('O perfil não contém texto analisável.');
        badRequestError.statusCode = 400;
        throw badRequestError;
    }
    
    // O resto da sua lógica de análise complexa permanece aqui...
    // ... (código da lógica de embeddings, VSS, e IA) ...

    log(`Análise HÍBRIDA (SQLite-VSS) concluída em ${Date.now() - startTime}ms.`);
    
    // Este é um exemplo de retorno, substitua pelo seu objeto 'result' real
    const result = { 
        overallScore: 85, 
        profileName: profileData.name, 
        profileHeadline: profileData.headline, 
        categories: [] // Preencha com os resultados reais
    };

    return result;

  } catch (err) {
    error('Erro durante a análise de match HÍBRIDA (SQLite-VSS):', err.message);
    // Re-lança o erro para que o controller possa capturá-lo e enviar a resposta HTTP correta.
    throw err;
  }
};