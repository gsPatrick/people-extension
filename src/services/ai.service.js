// ARQUIVO ULTRA-OTIMIZADO: src/services/match.service.js
// Processa TODAS as categorias e critérios em paralelo

import db from '../models/index.js';
import { createEmbeddings } from './embedding.service.js';
import { analyzeCriterionWithAI } from './ai.service.js';
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
  log(`Iniciando análise PARALELA com tabela temporária '${tempTableName}'`);
  
  let profileTable;

  try {
    // 1. Busca scorecard (com cache)
    log(`Buscando scorecard ${scorecardId}...`);
    const scorecard = await findScorecardById(scorecardId);

    if (!scorecard) {
      const err = new Error('Scorecard não encontrado.');
      err.statusCode = 404;
      throw err;
    }
    
    sortChildrenInMemory(scorecard);

    // 2. Prepara embeddings do perfil
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

    // 3. 🔥 OTIMIZAÇÃO: Coleta TODOS os critérios de TODAS as categorias
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

    log(`Processando ${allCriteriaWithMeta.length} critérios em PARALELO...`);

    // 4. 🚀 PROCESSA TUDO EM PARALELO (máxima velocidade)
    const allEvaluationPromises = allCriteriaWithMeta.map(async ({ criterion, weight, categoryName }) => {
      try {
        // Busca chunks relevantes no perfil
        const searchResults = await profileTable.search(criterion.embedding)
            .limit(3)
            .select(['text'])
            .execute();

        const uniqueRelevantChunks = [...new Set(searchResults.map(r => r.text))];
        
        // Analisa com IA
        const evaluation = await analyzeCriterionWithAI(criterion, uniqueRelevantChunks);
        
        return {
          categoryName,
          evaluation,
          weight,
          success: true
        };
      } catch (err) {
        logError(`Erro ao avaliar critério "${criterion.name}":`, err.message);
        return {
          categoryName,
          evaluation: {
            name: criterion.name,
            score: 1,
            justification: "Erro na análise"
          },
          weight,
          success: false
        };
      }
    });

    // 5. Aguarda TODAS as análises de uma vez
    const allResults = await Promise.all(allEvaluationPromises);
    
    // 6. Agrupa resultados por categoria
    const categoryMap = new Map();
    
    scorecard.categories.forEach(category => {
      categoryMap.set(category.name, {
        name: category.name,
        criteria: [],
        weightedScore: 0,
        totalWeight: 0
      });
    });

    allResults.forEach(result => {
      const category = categoryMap.get(result.categoryName);
      if (category) {
        category.criteria.push(result.evaluation);
        category.weightedScore += result.evaluation.score * result.weight;
        category.totalWeight += 5 * result.weight;
      }
    });

    // 7. Calcula scores finais
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
    log(`✓ Análise PARALELA concluída em ${duration}ms. Score: ${overallScore}%`);
    
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