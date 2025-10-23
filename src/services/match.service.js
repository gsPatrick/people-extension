// ARQUIVO COMPLETO E FINAL (COM BYPASS DE CACHE): src/services/match.service.js

// <-- MUDANÇA: Importamos o 'db' diretamente para acessar o model.
import db from '../models/index.js';
// import { findById as findScorecardById } from './scorecard.service.js'; // Não usaremos mais esta importação aqui.
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

// Helper para ordenar em memória, copiado do scorecard.service para garantir consistência
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
  log(`Iniciando análise com tabela temporária '${tempTableName}'`);
  
  let profileTable;

  try {
    // --- MUDANÇA CRÍTICA: BUSCA DIRETA NO BANCO DE DADOS, IGNORANDO O CACHE ---
    log(`Buscando scorecard ${scorecardId} diretamente no banco de dados (bypass de cache)...`);
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
      throw new Error('Scorecard não encontrado.');
    }
    
    // Converte para objeto simples e ordena em memória, como no serviço original
    const scorecard = scorecardInstance.get({ plain: true });
    sortChildrenInMemory(scorecard);
    // --- FIM DA MUDANÇA ---

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
    logError(`Erro durante a análise para o scorecard ${scorecardId}:`, err.message);
    const serviceError = new Error(err.message);
    serviceError.statusCode = err.message === 'Scorecard não encontrado.' ? 404 : 500;
    throw serviceError;
  } finally {
    if (profileTable) {
        await dropProfileVectorTable(tempTableName);
    }
  }
};