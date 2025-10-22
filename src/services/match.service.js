// ARQUIVO COMPLETO E FINAL (HÍBRIDO OTIMIZADO): src/services/match.service.js

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
  log(`Iniciando análise HÍBRIDA-OTIMIZADA para "${profileData.name || 'perfil sem nome'}"`);

  try {
    // 1. Buscas Iniciais em Paralelo (Scorecard e Embeddings do Perfil)
    const [scorecard, profileChunks] = await Promise.all([
        findScorecardById(scorecardId),
        chunkProfile(profileData)
    ]);

    if (!scorecard) {
      const err = new Error('Scorecard não encontrado.');
      err.statusCode = 404;
      throw err;
    }
    if (profileChunks.length === 0) {
      const err = new Error('O perfil não contém texto analisável.');
      err.statusCode = 400;
      throw err;
    }
    
    const profileEmbeddings = await createEmbeddings(profileChunks);

    // 2. Mapeamento de Evidências (Busca Vetorial Invertida)
    const evidenceMap = new Map(); // Mapa: criterionId -> [evidências em texto]

    // Para cada chunk do perfil, buscamos os critérios mais relevantes
    const searchPromises = profileEmbeddings.map(async (profileVector, index) => {
        const profileChunkText = profileChunks[index];
        // Busca os 2 critérios mais próximos para cada chunk do perfil
        const searchResults = await searchSimilarVectors(profileVector, 2);
        
        searchResults.forEach(result => {
            const criterionId = result.uuid;
            // Opcional: Adicionar um filtro de distância para evitar matches ruins
            // if (result._distance < 0.8) { 
                if (!evidenceMap.has(criterionId)) {
                    evidenceMap.set(criterionId, []);
                }
                evidenceMap.get(criterionId).push(profileChunkText);
            // }
        });
    });

    await Promise.all(searchPromises);

    // 3. Análise Focada com IA (em Paralelo)
    const categoryResults = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const category of scorecard.categories) {
      const analysisPromises = (category.criteria || []).map(async (criterion) => {
        // Pega as evidências coletadas para este critério
        const relevantChunks = evidenceMap.get(criterion.id) || [];
        const uniqueRelevantChunks = [...new Set(relevantChunks)]; // Remove duplicatas

        // Envia para a IA apenas o critério e suas evidências diretas
        const evaluation = await analyzeCriterionWithAI(criterion, uniqueRelevantChunks);
        return { evaluation, weight: criterion.weight };
      });

      const resolvedEvaluations = await Promise.all(analysisPromises);
      
      let categoryWeightedScore = 0;
      let categoryTotalWeight = 0;
      const criteriaEvaluations = [];

      resolvedEvaluations.forEach(result => {
        if (result) {
            criteriaEvaluations.push(result.evaluation);
            categoryWeightedScore += result.evaluation.score * result.weight;
            categoryTotalWeight += 5 * result.weight;
        }
      });
      
      const categoryScore = categoryTotalWeight > 0 ? Math.round((categoryWeightedScore / categoryTotalWeight) * 100) : 0;
      totalWeightedScore += categoryWeightedScore;
      totalWeight += categoryTotalWeight;
      
      categoryResults.push({ name: category.name, score: categoryScore, criteria: criteriaEvaluations });
    }

    // 4. Consolidação do Resultado
    const overallScore = totalWeight > 0 ? Math.round((totalWeightedScore / totalWeight) * 100) : 0;
    const result = {
        overallScore,
        profileName: profileData.name,
        profileHeadline: profileData.headline,
        categories: categoryResults
    };
    const duration = Date.now() - startTime;
    log(`Análise HÍBRIDA-OTIMIZADA concluída em ${duration}ms. Score final: ${overallScore}%`);
    
    return result;
  } catch (err) {
    logError('Erro durante a análise de match HÍBRIDA-OTIMIZADA:', err.message);
    throw err;
  }
};