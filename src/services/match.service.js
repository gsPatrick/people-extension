// ARQUIVO COMPLETO, FINAL E OTIMIZADO: src/services/match.service.js

import { findById as findScorecardById } from './scorecard.service.js';
import { analyzeProfileHolistically } from './ai.service.js';
import { log, error as logError } from '../utils/logger.service.js';

/**
 * Orquestra a análise de match fazendo uma única chamada para o serviço de IA.
 */
export const analyze = async (scorecardId, profileData) => {
  const startTime = Date.now();
  log(`Iniciando análise "Single-Shot" para "${profileData.name || 'perfil sem nome'}"`);

  try {
    // 1. Busca o scorecard no nosso banco de dados. É rápido.
    const scorecard = await findScorecardById(scorecardId);
    if (!scorecard) {
      const err = new Error('Scorecard não encontrado.');
      err.statusCode = 404;
      throw err;
    }
    
    // 2. Chama a função de IA holística. Esta é a única chamada de rede demorada.
    const result = await analyzeProfileHolistically(scorecard, profileData);
    
    const duration = Date.now() - startTime;
    log(`Análise "Single-Shot" concluída em ${duration}ms. Score final: ${result.overallScore}%`);
    
    return result;

  } catch (err) {
    logError('Erro durante a análise de match "Single-Shot":', err.message);
    // Repassa o erro para o controller
    throw err;
  }
};