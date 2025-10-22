import { findById as findScorecardById } from './scorecard.service.js';
import { createEmbeddings } from './embedding.service.js';
import { analyzeCriterionWithAI } from './ai.service.js';
import { log, error } from '../utils/logger.service.js';
import db from '../models/index.js'; // CORREÇÃO 1: Importar o objeto 'db' padrão
const { sequelize } = db; // CORREÇÃO 2: Extrair o sequelize do objeto 'db'

const chunkProfile = (profileData) => {
  // ... (código interno da função permanece igual)
  const chunks = [];
  if (profileData.headline) chunks.push(`Título: ${profileData.headline}`);
  if (profileData.about) chunks.push(`Sobre: ${profileData.about}`);
  if (profileData.skills?.length) chunks.push(`Competências: ${profileData.skills.join(', ')}`);
  if (profileData.experience) {
    profileData.experience.forEach(exp => {
      chunks.push(`Experiência: ${exp.title} na ${exp.companyName}. ${exp.description || ''}`);
    });
  }
  return chunks.filter(Boolean);
};

export const analyze = async (scorecardId, profileData) => {
  // ... (código interno da função permanece igual)
  const startTime = Date.now();
  log(`Iniciando análise HÍBRIDA (SQLite-VSS) para "${profileData.name}"`);

  try {
    const scorecard = await findScorecardById(scorecardId);
    if (!scorecard) throw new Error('Scorecard não encontrado.');

    const profileChunks = chunkProfile(profileData);
    if (profileChunks.length === 0) throw new Error('O perfil não contém texto analisável.');
    
    const profileEmbeddings = await createEmbeddings(profileChunks);

    await sequelize.query('CREATE VIRTUAL TABLE temp_profile_embeddings USING vss0(embedding(1536));');
    
    const insertStmt = await sequelize.prepare('INSERT INTO temp_profile_embeddings (rowid, embedding) VALUES (?, ?)');
    for (let i = 0; i < profileEmbeddings.length; i++) {
        await insertStmt.run(i + 1, vectorToBuffer(profileEmbeddings[i]));
    }
    await insertStmt.finalize();

    const categoryResults = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const category of scorecard.categories) {
      const analysisPromises = category.criteria.map(async (criterion) => {
        if (!criterion.embedding) return null;

        const query = `
          SELECT c.text, v.distance
          FROM temp_profile_embeddings AS v
          JOIN (SELECT rowid, value AS text FROM json_each(:profileChunks)) AS c ON v.rowid = c.rowid + 1
          WHERE vss_search(v.embedding, vss_search_params(?, 3))
        `;
        const relevantChunks = await sequelize.query(query, {
            replacements: { 
                profileChunks: JSON.stringify(profileChunks),
                queryVector: vectorToBuffer(criterion.embedding)
            },
            type: sequelize.QueryTypes.SELECT,
        });
        
        const evaluation = await analyzeCriterionWithAI(criterion, relevantChunks.map(r => r.text));
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

    await sequelize.query('DROP TABLE temp_profile_embeddings;');

    const overallScore = totalWeight > 0 ? Math.round((totalWeightedScore / totalWeight) * 100) : 0;

    const result = { overallScore, profileName: profileData.name, profileHeadline: profileData.headline, categories: categoryResults };

    const duration = Date.now() - startTime;
    log(`Análise HÍBRIDA (SQLite-VSS) concluída em ${duration}ms. Score: ${overallScore}%`);
    
    return result;

  } catch (err) {
    await sequelize.query('DROP TABLE IF EXISTS temp_profile_embeddings;').catch(() => {});
    error('Erro durante a análise de match HÍBRIDA (SQLite-VSS):', err.message);
    throw err;
  }
};

const vectorToBuffer = (vector) => {
  if (!vector) return null;
  const float32Array = new Float32Array(vector);
  return Buffer.from(float32Array.buffer);
};