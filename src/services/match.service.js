// VERSÃO BATCH EXTREMA: src/services/match.service.js
// Usa analyzeAllCriteriaInBatch para máxima velocidade

import db from '../models/index.js';
import { createEmbeddings } from './embedding.service.js';
import { analyzeAllCriteriaInBatch } from './ai.service.js'; // <-- Mudança aqui
import { createProfileVectorTable, dropProfileVectorTable } from './vector.service.js';
import { log, error as logError } from '../utils/logger.service.js';
import { findById as findScorecardById } from './scorecard.service.js';

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

const sortChildrenInMemory = (data) => {
    if (data.categories) {
        data.categories.sort((a, b) => a.order - b.order);
        data.categories.forEach(category => {
            if (category.criteria) {
                category.criteria.sort((a, b) => a.order - b.order);
            } else {
                category.criteria = [];
            }
        });
    }
};

export const analyze = async (scorecardId, profileData) => {
  const startTime = Date.now();
  const tempTableName = `profile_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  log(`Iniciando análise BATCH EXTREMA com '${tempTableName}'`);
  
  let profileTable;

  try {
    // 1. Busca scorecard
    const scorecard = await findScorecardById(scorecardId);
    if (!scorecard) {
      const err = new Error('Scorecard não encontrado.');
      err.statusCode = 404;
      throw err;
    }
    sortChildrenInMemory(scorecard);

    // 2. Cria embeddings do perfil
    const profileChunks = chunkProfile(profileData);
    if (profileChunks.length === 0) {
      throw new Error('O perfil não contém texto analisável.');
    }
    
    const profileEmbeddings = await createEmbeddings(profileChunks);
    const profileDataForLance = profileEmbeddings.map((vector, i) => ({
      vector,
      text: profileChunks[i]
    }));
    profileTable = await createProfileVectorTable(tempTableName, profileDataForLance);

    // 3. 🔥 Busca chunks relevantes para TODOS os critérios em paralelo
    const allCriteriaWithMeta = [];
    
    scorecard.categories.forEach(category => {
      (category.criteria || []).forEach(criterion => {
        if (!criterion.embedding) {
          logError(`Critério "${criterion.name}" sem embedding. Pulando.`);
          return;
        }
        allCriteriaWithMeta.push({
          categoryName: category.name,
          criterion,
          weight: criterion.weight
        });
      });
    });

    log(`Buscando chunks para ${allCriteriaWithMeta.length} critérios...`);

    // 4. Busca chunks em paralelo para todos os critérios
    const chunksSearchPromises = allCriteriaWithMeta.map(async ({ criterion, categoryName, weight }) => {
      const searchResults = await profileTable.search(criterion.embedding)
          .limit(3)
          .select(['text'])
          .execute();

      const chunks = [...new Set(searchResults.map(r => r.text))];
      
      return {
        categoryName,
        criterion,
        weight,
        chunks
      };
    });

    const criteriaWithChunks = await Promise.all(chunksSearchPromises);

    // 5. 🚀 ANÁLISE EM BATCH (1 ou poucas chamadas à API)
    log(`Analisando ${criteriaWithChunks.length} critérios em BATCH...`);
    const evaluations = await analyzeAllCriteriaInBatch(criteriaWithChunks);

    // 6. Mapeia resultados de volta aos critérios
    const resultsMap = new Map(
      evaluations.map(ev => [ev.name, ev])
    );

    // 7. Agrupa por categoria
    const categoryMap = new Map();
    
    scorecard.categories.forEach(category => {
      categoryMap.set(category.name, {
        name: category.name,
        criteria: [],
        weightedScore: 0,
        totalWeight: 0
      });
    });

    criteriaWithChunks.forEach(({ categoryName, criterion, weight }) => {
      const evaluation = resultsMap.get(criterion.name) || {
        name: criterion.name,
        score: 1,
        justification: "Análise não disponível"
      };

      const category = categoryMap.get(categoryName);
      if (category) {
        category.criteria.push(evaluation);
        category.weightedScore += evaluation.score * weight;
        category.totalWeight += 5 * weight;
      }
    });

    // 8. Calcula scores finais
    let totalWeightedScore = 0;
    let totalWeight = 0;
    const categoryResults = [];

    categoryMap.forEach(category => {
      const categoryScore = category.totalWeight > 0 
        ? Math.round((category.weightedScore / category.totalWeight) * 100) 
        : 0;
      
      totalWeightedScore += category.weightedScore;
      totalWeight += category.totalWeight;
      
      categoryResults.push({
        name: category.name,
        score: categoryScore,
        criteria: category.criteria
      });
    });

    const overallScore = totalWeight > 0 
      ? Math.round((totalWeightedScore / totalWeight) * 100) 
      : 0;

    const result = {
        overallScore,
        profileName: profileData.name,
        profileHeadline: profileData.headline,
        categories: categoryResults
    };

    const duration = Date.now() - startTime;
    log(`✓ Análise BATCH EXTREMA concluída em ${duration}ms. Score: ${overallScore}%`);
    
    return result;

  } catch (err) {
    logError('Erro na análise:', err.message);
    throw err;
  } finally {
    if (profileTable) {
        await dropProfileVectorTable(tempTableName);
    }
  }
};