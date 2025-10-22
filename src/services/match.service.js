// ARQUIVO COMPLETO E DEFINITIVO: src/services/match.service.js

import { findById as findScorecardById } from './scorecard.service.js';
// <-- MUDANÇA CRÍTICA: As importações de serviços com potencial de ciclo foram removidas do topo.
// import { createEmbeddings } from './embedding.service.js';
// import { analyzeCriterionWithAI } from './ai.service.js';
import { searchSimilarVectors } from './vector.service.js';
import { log, error as logError } from '../utils/logger.service.js';

/**
 * Divide os dados textuais de um perfil em pedaços (chunks) para análise.
 */
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

/**
 * Realiza a análise de match de um perfil contra um scorecard usando LanceDB e IA.
 */
export const analyze = async (scorecardId, profileData) => {
  // <-- MUDANÇA CRÍTICA: Os serviços são importados aqui, dentro da função.
  const { createEmbeddings, createEmbedding } = await import('./embedding.service.js');
  const { analyzeCriterionWithAI } = await import('./ai.service.js');

  const startTime = Date.now();
  log(`Iniciando análise com LanceDB para "${profileData.name || 'perfil sem nome'}"`);

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

    const categoryResults = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const category of scorecard.categories) {
      const analysisPromises = (category.criteria || []).map(async (criterion) => {
        const textToSearch = criterion.description || criterion.name;
        if (!textToSearch) return null;

        const criterionEmbedding = await createEmbedding(textToSearch);
        if (!criterionEmbedding) return null;
        
        const searchResults = await searchSimilarVectors(criterionEmbedding, 5);
        
        // Esta lógica de encontrar os chunks mais relevantes precisa ser mais robusta.
        // Vamos associar o chunk ao seu embedding para uma busca precisa.
        const chunkEmbeddingsMap = new Map(profileEmbeddings.map((emb, i) => [emb, profileChunks[i]]));
        const relevantChunks = [];
        
        for (const result of searchResults) {
            // A busca no LanceDB retorna um vetor. Precisamos encontrar o chunk original.
            // A maneira mais direta é encontrar o embedding mais próximo na nossa lista original.
            let closestEmbedding = null;
            let minDistance = Infinity;

            for (const profileEmb of profileEmbeddings) {
                // Simple Euclidean distance for comparison
                const dist = Math.sqrt(result.vector.reduce((sum, val, i) => sum + Math.pow(val - profileEmb[i], 2), 0));
                if (dist < minDistance) {
                    minDistance = dist;
                    closestEmbedding = profileEmb;
                }
            }
            
            if (closestEmbedding && chunkEmbeddingsMap.has(closestEmbedding)) {
                relevantChunks.push(chunkEmbeddingsMap.get(closestEmbedding));
            }
        }
        
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
    log(`Análise com LanceDB concluída em ${duration}ms. Score final: ${overallScore}%`);
    
    return result;

  } catch (err) {
    logError('Erro durante a análise de match com LanceDB:', err.message);
    throw err;
  }
};