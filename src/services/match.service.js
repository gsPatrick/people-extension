// ARQUIVO COMPLETO E FINAL: src/services/match.service.js

import db from '../models/index.js';
import { createEmbeddings } from './embedding.service.js';
import { analyzeCriterionWithAI } from './ai.service.js';
import { createProfileVectorTable, dropProfileVectorTable } from './vector.service.js';
import { log, error as logError } from '../utils/logger.service.js';

/**
 * Divide os dados textuais de um perfil em pedaços (chunks) para análise.
 * @param {object} profileData - Os dados do perfil.
 * @returns {string[]} Um array de strings, onde cada string é um chunk de texto.
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
 * Função helper para ordenar os resultados em memória, em vez de na query SQL.
 * @param {object} data - O objeto scorecard ou categoria.
 */
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

/**
 * Orquestra a análise de match. Esta função executa a lógica de negócio
 * e lança um erro em caso de falha, que deve ser capturado pelo controller.
 */
export const analyze = async (scorecardId, profileData) => {
  const startTime = Date.now();
  // Cria um nome de tabela único e aleatório para esta requisição.
  const tempTableName = `profile_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  log(`Iniciando análise com tabela temporária '${tempTableName}'`);
  
  let profileTable;

  try {
    // 1. Busca Direta no Banco de Dados (Bypass de Cache)
    log(`Buscando scorecard ${scorecardId} diretamente no banco de dados...`);
    const scorecardInstance = await db.Scorecard.findByPk(scorecardId, {
      include: [
        {
          model: db.Category,
          as: 'categories',
          separate: true,
          include: [{ model: db.Criterion, as: 'criteria' }],
        },
      ],
    });

    if (!scorecardInstance) {
      const err = new Error('Scorecard não encontrado.');
      err.statusCode = 404; // Adiciona status code para o controller.
      throw err;
    }
    
    // Converte para objeto simples e ordena em memória.
    const scorecard = scorecardInstance.get({ plain: true });
    sortChildrenInMemory(scorecard);

    // 2. Preparação dos Dados do Perfil
    const profileChunks = chunkProfile(profileData);
    if (profileChunks.length === 0) {
      throw new Error('O perfil não contém texto analisável.');
    }
    
    // 3. Geração de Embeddings e População da Tabela Temporária
    const profileEmbeddings = await createEmbeddings(profileChunks);
    const profileDataForLance = profileEmbeddings.map((vector, i) => ({
      vector,
      text: profileChunks[i]
    }));
    profileTable = await createProfileVectorTable(tempTableName, profileDataForLance);

    // 4. Análise Focada (Busca Vetorial + IA)
    const categoryResults = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const category of scorecard.categories) {
      const analysisPromises = (category.criteria || []).map(async (criterion) => {
        if (!criterion.embedding) {
          logError(`Critério "${criterion.name}" (ID: ${criterion.id}) não possui embedding. Pulando.`);
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

    // 5. Consolidação do Resultado
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
    // Apenas relança o erro. O controller será responsável por logar e responder.
    throw err;
  } finally {
    // 6. Limpeza (SEMPRE executa, no sucesso ou no erro)
    if (profileTable) {
        await dropProfileVectorTable(tempTableName);
    }
  }
};