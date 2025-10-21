import { findById as findScorecardById } from './scorecard.service.js';
import { createEmbeddings } from './embedding.service.js';
import { analyzeCriterionWithAI } from './ai.service.js';
import { log, error } from '../utils/logger.service.js';
import { sequelize } from '../models';
import { toSql } from 'pg-vector';

/**
 * Quebra o perfil em pedaços de texto significativos para análise.
 */
const chunkProfile = (profileData) => {
  const chunks = [];
  if (profileData.headline) chunks.push(`Título: ${profileData.headline}`);
  if (profileData.about) chunks.push(`Sobre: ${profileData.about}`);
  if (profileData.skills && profileData.skills.length > 0) chunks.push(`Competências: ${profileData.skills.join(', ')}`);
  if (profileData.experience) {
    profileData.experience.forEach(exp => {
      chunks.push(`Experiência: ${exp.title} na ${exp.companyName}. ${exp.description || ''}`);
    });
  }
  return chunks.filter(Boolean);
};

/**
 * Orquestra a análise de match instantânea usando a arquitetura híbrida.
 */
export const analyze = async (scorecardId, profileData) => {
  const startTime = Date.now();
  log(`Iniciando análise HÍBRIDA para "${profileData.name}" com scorecard ${scorecardId}`);

  try {
    const scorecard = await findScorecardById(scorecardId);
    if (!scorecard) throw new Error('Scorecard não encontrado.');

    const profileChunks = chunkProfile(profileData);
    if (profileChunks.length === 0) throw new Error('O perfil não contém texto analisável.');
    
    const profileEmbeddings = await createEmbeddings(profileChunks);

    const categoryResults = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const category of scorecard.categories) {
      const criteriaEvaluations = [];
      let categoryWeightedScore = 0;
      let categoryTotalWeight = 0;

      // Cria um array de promises para executar as análises de IA em paralelo
      const analysisPromises = category.criteria.map(async (criterion) => {
        if (!criterion.embedding) return null;

        const relevantChunks = await findRelevantChunks(criterion.embedding, profileChunks, profileEmbeddings);
        const evaluation = await analyzeCriterionWithAI(criterion, relevantChunks);
        
        return { evaluation, weight: criterion.weight };
      });

      // Executa todas as análises da categoria em paralelo
      const resolvedEvaluations = await Promise.all(analysisPromises);
      
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
      
      categoryResults.push({
        name: category.name,
        score: categoryScore,
        criteria: criteriaEvaluations,
      });
    }

    const overallScore = totalWeight > 0 ? Math.round((totalWeightedScore / totalWeight) * 100) : 0;

    const result = {
      overallScore,
      profileName: profileData.name,
      profileHeadline: profileData.headline,
      categories: categoryResults,
    };

    const duration = Date.now() - startTime;
    log(`Análise HÍBRIDA concluída em ${duration}ms. Score: ${overallScore}%`);
    
    return result;

  } catch (err) {
    error('Erro durante a análise de match HÍBRIDA:', err.message);
    throw err;
  }
};

/**
 * Encontra os trechos de texto mais relevantes de um perfil para um dado critério
 * usando busca vetorial NATIVA do pgvector para máxima performance.
 */
async function findRelevantChunks(criterionEmbedding, profileChunks, profileEmbeddings, topK = 3) {
  try {
    // Para esta função, precisamos dos vetores e dos textos.
    // Vamos criar uma estrutura temporária para a query.
    const tempTableName = `temp_profile_chunks_${Date.now()}`;

    // Esta query usa `unnest` para criar uma "tabela virtual" a partir dos nossos arrays,
    // permitindo que o `pgvector` opere sobre ela.
    const query = `
      SELECT text
      FROM unnest(:texts::text[], :embeddings::vector[]) AS t(text, embedding)
      ORDER BY t.embedding <=> :criterionEmbedding::vector
      LIMIT :limit;
    `;

    const results = await sequelize.query(query, {
      replacements: {
        texts: profileChunks,
        embeddings: profileEmbeddings.map(e => toSql(e)),
        criterionEmbedding: toSql(JSON.parse(criterionEmbedding)),
        limit: topK,
      },
      type: sequelize.QueryTypes.SELECT,
    });
    
    return results.map(row => row.text);

  } catch (err) {
      error("Erro na busca por chunks relevantes com pgvector:", err.message);
      // Fallback para o primeiro chunk em caso de erro no DB
      return profileChunks.slice(0, 1);
  }
}

// Helper para cálculo de similaridade (usado apenas como fallback ou em lógicas não-SQL)
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}