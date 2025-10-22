// ARQUIVO COMPLETO: src/services/match.service.js

import { findById as findScorecardById } from './scorecard.service.js';
// import { createEmbeddings } from './embedding.service.js'; // Não é mais usado
// import { analyzeCriterionWithAI } from './ai.service.js'; // Não é mais usado
import { log, error } from '../utils/logger.service.js';
// import db from '../models/index.js'; // Não é mais usado

/**
 * ATENÇÃO: A funcionalidade de match por vetor foi temporariamente desativada
 * durante a migração para o PostgreSQL. Esta função irá retornar um erro
 * indicando que a funcionalidade não está implementada.
 */
export const analyze = async (scorecardId, profileData) => {
  log(`Tentativa de análise de match para o scorecard ${scorecardId} (FUNCIONALIDADE DESATIVADA).`);
  
  // Cria e lança um erro com status code para o controller capturar.
  const err = new Error('A funcionalidade de Match com IA (busca por vetor) está temporariamente desativada. Será reintegrada com LanceDB/pgvector.');
  err.statusCode = 501; // 501 Not Implemented
  
  throw err;
};