// ARQUIVO COMPLETO E CORRIGIDO: src/services/match.service.js

import { findById as findScorecardById } from './scorecard.service.js';
import { createEmbeddings } from './embedding.service.js';
import { analyzeCriterionWithAI } from './ai.service.js';
import { searchSimilarVectors } from './vector.service.js';
import { log, error as logError } from '../utils/logger.service.js';

const chunkProfile = (profileData) => {
  const chunks = [];
  if (profileData.headline) chunks.push(`Título: ${profileData.headline}`);
  if (profileData.about) chunks.push(`Sobre: ${profileData.about}`);
  if (profileData.skills?.length) chunks.push(`Competências: ${profileData.skills.join(', ')}`);
  if (profileData.experience) {
    profileData.experience.forEach(exp => {
      chunks.push(`Experiência: ${exp.title} na ${exp.companyName}. ${exp.description || ''}`.trim());
    });
  }
  return chunks.filter(Boolean);
};

export const analyze = async (scorecardId, profileData) => {
  const startTime = Date.now();
  log(`Iniciando análise OTIMIZADA com LanceDB para "${profileData.name || 'perfil sem nome'}"`);

  try {
    const scorecard = await findScorecardById(scorecardId);
    if (!scorecard) {
      const err = new Error('Scorecard não encontrado.');
      err.statusCode = 404;
      throw err;
    }

    const profileChunks = chunkProfile(profileData);
    if (profileChunks.length === 0) {
      const err = new Error('O perfil não contém texto analisável.');
      err.statusCode = 400;
      throw err;
    }
    
    const profileEmbeddings = await createEmbeddings(profileChunks);
    const chunkEmbeddingsMap = new Map(profileEmbeddings.map((emb, i) => [emb, profileChunks[i]]));

    const categoryResults = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const category of scorecard.categories) {
      const analysisPromises = (category.criteria || []).map(async (criterion) => {
        if (!criterion.embedding) {
          logError(`Critério "${criterion.name}" (ID: ${criterion.id}) não possui embedding pré-calculado. Pulando.`);
          return null;
        }
        
        const searchResults = await searchSimilarVectors(criterion.embedding, 5);
        
        const relevantChunks = searchResults.map(result => {
             let bestMatchIndex = -1;
             let minDistance = Infinity;

             for (let i = 0; i < profileEmbeddings.length; i++) {
                 const profileEmb = profileEmbeddings[i];
                 
                 // <-- MUDANÇA CRÍTICA AQUI -->
                 // A comparação deve ser entre os elementos de mesmo índice de cada vetor.
                 const dist = Math.sqrt(
                     result.vector.reduce((sum, val, j) => sum + Math.pow(val - profileEmb[j], 2), 0)
                 );
                 
                 if (dist < minDistance) {
                     minDistance = dist;
                     bestMatchIndex = i;
                 }
             }
             return profileChunks[bestMatchIndex];
        }).filter(Boolean);

        const uniqueRelevantChunks = [...new Set(relevantChunks)];

        const evaluation = await analyzeCriterionWithAI(criterion, uniqueRelevantChunks);
        return { evaluation, weight: criterion.weight };
      });

      const resolvedEvaluations = (await Promise.all(analysisPromises)).filter(Boolean);
      
      let categoryWeightedScore = 0;
      let categoryTotalWeight = 0;
      const criteriaEvaluations = [];

      resolvedEvaluations.forEach(result => {
        criteriaEvaluations.push(result.evaluation);
        categoryWeightedScore += result.evaluation.score * result.weight;
        categoryTotalWeight += 5 * result.weight;
      });
      
      const categoryScore = categoryTotalWeight > 0 ? Math.round((categoryWeightedScore / categoryTotalWeight) * 100) : 0;
      totalWeightedScore += categoryWeightedScore;
      totalWeight += categoryTotalWeight;
      
      categoryResults.push({ name: category.name, score: categoryScore, criteria: criteriaEvaluations });
    }

    const overallScore = totalWeight > 0 ? Math.round((totalWeightedScore / totalWeight) * 100) : 0;
    const result = {
        overallScore,
        profileName: profileData.name,
        profileHeadline: profileData.headline,
        categories: categoryResults
    };
    const duration = Date.now() - startTime;
    log(`Análise OTIMIZADA com LanceDB concluída em ${duration}ms. Score final: ${overallScore}%`);
    
    return result;
  } catch (err) {
    logError('Erro durante a análise de match com LanceDB:', err.message);
    throw err;
  }
};