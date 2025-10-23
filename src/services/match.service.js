// ARQUIVO COMPLETO, FINAL E CORRIGIDO: src/services/match.service.js

import { findById as findScorecardById } from './scorecard.service.js';
import { createEmbeddings } from './embedding.service.js';
import { analyzeCriterionWithAI } from './ai.service.js';
import { createProfileVectorTable, dropProfileVectorTable } from './vector.service.js';
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
  const tempTableName = `profile_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  log(`Iniciando análise com tabela temporária '${tempTableName}'`);
  
  let profileTable;

  try {
    // --- FLUXO LINEAR E SEGURO ---

    // 1. Busca o Scorecard primeiro. É rápido e essencial para o resto.
    const scorecard = await findScorecardById(scorecardId);
    if (!scorecard) {
      // Se não encontrar aqui, lança o erro imediatamente.
      throw new Error('Scorecard não encontrado.');
    }

    // 2. Prepara os dados do perfil.
    const profileChunks = chunkProfile(profileData);
    if (profileChunks.length === 0) {
      throw new Error('O perfil não contém texto analisável.');
    }
    
    // 3. Gera os embeddings (a parte mais demorada).
    const profileEmbeddings = await createEmbeddings(profileChunks);
    
    // 4. Cria e popula a tabela temporária no LanceDB.
    const profileDataForLance = profileEmbeddings.map((vector, i) => ({
      vector,
      text: profileChunks[i]
    }));
    profileTable = await createProfileVectorTable(tempTableName, profileDataForLance);

    // 5. Análise Focada (Busca Vetorial + IA)
    const categoryResults = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const category of scorecard.categories) {
      const analysisPromises = (category.criteria || []).map(async (criterion) => {
        if (!criterion.embedding) {
          logError(`Critério "${criterion.name}" não possui embedding. Pulando.`);
          return null;
        }
        
        const searchResults = await profileTable.search(criterion.embedding)
            .limit(3)
            .select(['text'])
            .execute();

        const uniqueRelevantChunks = [...new Set(searchResults.map(result => result.text))];

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

    // 6. Consolidação do Resultado
    const overallScore = totalWeight > 0 ? Math.round((totalWeightedScore / totalWeight) * 100) : 0;
    const result = {
        overallScore,
        profileName: profileData.name,
        profileHeadline: profileData.headline,
        categories: categoryResults
    };
    const duration = Date.now() - startTime;
    log(`Análise com tabela temporária concluída em ${duration}ms. Score: ${overallScore}%`);
    
    return result;

  } catch (err) {
    // Adiciona mais contexto ao erro para facilitar o debug
    logError(`Erro durante a análise para o scorecard ${scorecardId}:`, err.message);
    const serviceError = new Error(err.message);
    serviceError.statusCode = err.message === 'Scorecard não encontrado.' ? 404 : 500;
    throw serviceError;
  } finally {
    // Limpeza da tabela temporária
    if (profileTable) {
        await dropProfileVectorTable(tempTableName);
    }
  }
};