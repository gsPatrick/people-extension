import { findById as findScorecardById } from './scorecard.service.js';
import { createEmbeddings } from './embedding.service.js';
import { analyzeCriterionWithAI } from './ai.service.js';
import { log, error } from '../utils/logger.service.js';
import db from '../models/index.js';

const { sequelize } = db;

/**
 * Converte um array de números (vetor) em um Buffer para armazenamento no SQLite.
 * @param {number[]} vector O vetor de embedding.
 * @returns {Buffer}
 */
const vectorToBuffer = (vector) => {
  if (!vector) return null;
  const float32Array = new Float32Array(vector);
  return Buffer.from(float32Array.buffer);
};

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
      const expText = `Experiência: ${exp.title} na ${exp.companyName}. ${exp.description || ''}`;
      chunks.push(expText.trim());
    });
  }
  return chunks.filter(Boolean); // Remove chunks vazios
};

/**
 * Realiza a análise de match de um perfil contra um scorecard usando uma abordagem híbrida
 * de busca vetorial (VSS) e análise por IA.
 * @param {string} scorecardId - O ID do scorecard.
 * @param {object} profileData - Os dados do perfil do LinkedIn.
 * @returns {Promise<object>} O resultado detalhado da análise.
 */
export const analyze = async (scorecardId, profileData) => {
  const startTime = Date.now();
  log(`Iniciando análise HÍBRIDA (SQLite-VSS) para "${profileData.name || 'perfil sem nome'}"`);

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

    // Cria uma tabela virtual temporária em memória para a busca vetorial
    await sequelize.query('CREATE VIRTUAL TABLE temp_profile_embeddings USING vss0(embedding(1536));');
    
    // Insere os embeddings do perfil na tabela temporária
    for (let i = 0; i < profileEmbeddings.length; i++) {
        await sequelize.query('INSERT INTO temp_profile_embeddings (rowid, embedding) VALUES (?, ?);', {
            replacements: [i + 1, vectorToBuffer(profileEmbeddings[i])]
        });
    }

    const categoryResults = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const category of scorecard.categories) {
      const analysisPromises = category.criteria.map(async (criterion) => {
        if (!criterion.embedding) return null;

        // Para cada critério, busca os chunks de perfil mais relevantes usando VSS
        const query = `
          SELECT
            c.value as text,
            v.distance
          FROM temp_profile_embeddings AS v
          LEFT JOIN json_each(:profileChunks) AS c ON v.rowid = c.key + 1
          WHERE vss_search(
            v.embedding,
            vss_search_params(?, 5) -- Busca os 5 chunks mais próximos
          )
          ORDER BY v.distance
          LIMIT 5;
        `;
        const relevantChunks = await sequelize.query(query, {
            replacements: { 
                profileChunks: JSON.stringify(profileChunks),
                queryVector: vectorToBuffer(criterion.embedding)
            },
            type: sequelize.QueryTypes.SELECT,
        });
        
        // Envia o critério e os chunks relevantes para a IA fazer a análise final
        const evaluation = await analyzeCriterionWithAI(criterion, relevantChunks.map(r => r.text));
        return { evaluation, weight: criterion.weight };
      });

      const resolvedEvaluations = (await Promise.all(analysisPromises)).filter(Boolean);
      
      let categoryWeightedScore = 0;
      let categoryTotalWeight = 0;
      const criteriaEvaluations = [];

      resolvedEvaluations.forEach(result => {
        criteriaEvaluations.push(result.evaluation);
        categoryWeightedScore += result.evaluation.score * result.weight; // score da IA (0-5) * peso do critério (1-3)
        categoryTotalWeight += 5 * result.weight; // score máximo (5) * peso do critério (1-3)
      });
      
      const categoryScore = categoryTotalWeight > 0 ? Math.round((categoryWeightedScore / categoryTotalWeight) * 100) : 0;
      totalWeightedScore += categoryWeightedScore;
      totalWeight += categoryTotalWeight;
      
      categoryResults.push({ name: category.name, score: categoryScore, criteria: criteriaEvaluations });
    }

    // Limpa a tabela temporária
    await sequelize.query('DROP TABLE temp_profile_embeddings;');

    const overallScore = totalWeight > 0 ? Math.round((totalWeightedScore / totalWeight) * 100) : 0;

    const result = {
        overallScore,
        profileName: profileData.name,
        profileHeadline: profileData.headline,
        categories: categoryResults
    };

    const duration = Date.now() - startTime;
    log(`Análise HÍBRIDA (SQLite-VSS) concluída em ${duration}ms. Score final: ${overallScore}%`);
    
    return result;

  } catch (err) {
    // Garante que a tabela temporária seja removida em caso de erro
    await sequelize.query('DROP TABLE IF EXISTS temp_profile_embeddings;').catch(cleanupErr => {
        error("Erro adicional ao tentar limpar a tabela temporária:", cleanupErr.message);
    });
    error('Erro durante a análise de match HÍBRIDA (SQLite-VSS):', err.message);
    throw err; // Re-lança o erro para o controller
  }
};