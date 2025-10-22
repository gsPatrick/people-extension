// ARQUIVO COMPLETO E ATUALIZADO: src/services/match.service.js

import { findById as findScorecardById } from './scorecard.service.js';
import { createEmbeddings } from './embedding.service.js';
import { analyzeCriterionWithAI } from './ai.service.js';
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
    
    // Gera os embeddings para cada pedaço de texto do perfil
    const profileEmbeddings = await createEmbeddings(profileChunks);

    const categoryResults = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const category of scorecard.categories) {
      const analysisPromises = category.criteria.map(async (criterion) => {
        // Pula se o critério não tiver texto para gerar embedding
        const textToSearch = criterion.description || criterion.name;
        if (!textToSearch) return null;

        // Gera o embedding para o critério "on-the-fly" para a busca
        const criterionEmbedding = await createEmbedding(textToSearch);
        if (!criterionEmbedding) return null;
        
        // Busca no LanceDB pelos vetores de perfil mais similares ao vetor do critério
        const searchResults = await searchSimilarVectors(criterionEmbedding, 5);

        // Mapeia os resultados da busca para extrair os chunks de texto originais
        const relevantChunks = searchResults.map(result => {
             // O LanceDB pode retornar vetores que não correspondem exatamente a um dos nossos,
             // então precisamos encontrar o chunk original pelo embedding mais próximo.
             // Esta é uma simplificação; uma implementação mais robusta poderia usar IDs.
             let bestMatchIndex = -1;
             let minDistance = Infinity;
             for (let i = 0; i < profileEmbeddings.length; i++) {
                 const dist = result._distance; // LanceDB fornece a distância
                 if (dist < minDistance) {
                     minDistance = dist;
                     bestMatchIndex = i; // Supondo que a ordem dos vetores foi mantida
                 }
             }
             return profileChunks[bestMatchIndex];
        }).filter(Boolean);


        // Envia o critério e os chunks relevantes para a IA fazer a análise final
        const evaluation = await analyzeCriterionWithAI(criterion, relevantChunks);
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