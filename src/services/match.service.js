// ARQUIVO COMPLETO, FINAL E CORRIGIDO: src/services/match.service.js

import { findById as findScorecardById } from './scorecard.service.js';
import { createEmbeddings } from './embedding.service.js';
import { analyzeCriterionWithAI } from './ai.service.js';
// <-- MUDANÇA: Importamos as novas funções de gerenciamento de tabelas
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
  // Cria um nome de tabela único para esta requisição específica
  const tempTableName = `profile_${Date.now()}`;
  log(`Iniciando análise com tabela temporária '${tempTableName}'`);
  
  let profileTable; // Variável para manter a referência da tabela

  try {
    // 1. Buscas Iniciais e Preparação
    const [scorecard, profileChunks] = await Promise.all([
        findScorecardById(scorecardId),
        chunkProfile(profileData)
    ]);

    if (!scorecard) throw new Error('Scorecard não encontrado.');
    if (profileChunks.length === 0) throw new Error('O perfil não contém texto analisável.');
    
    const profileEmbeddings = await createEmbeddings(profileChunks);
    
    // 2. Criação e População da Tabela Temporária no LanceDB
    const profileDataForLance = profileEmbeddings.map((vector, i) => ({
      vector,
      text: profileChunks[i] // Armazena o texto junto com o vetor
    }));
    profileTable = await createProfileVectorTable(tempTableName, profileDataForLance);

    // 3. Análise Focada (Busca Vetorial + IA)
    const categoryResults = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const category of scorecard.categories) {
      const analysisPromises = (category.criteria || []).map(async (criterion) => {
        if (!criterion.embedding) {
          logError(`Critério "${criterion.name}" não possui embedding. Pulando.`);
          return null;
        }
        
        // Etapa A: Busca vetorial na tabela temporária do perfil
        const searchResults = await profileTable.search(criterion.embedding)
            .limit(3) // Busca os 3 chunks mais relevantes
            .select(['text']) // Pede para o LanceDB retornar o campo de texto
            .execute();

        // Etapa B: Extrai o texto diretamente do resultado
        const relevantChunks = searchResults.map(result => result.text);
        const uniqueRelevantChunks = [...new Set(relevantChunks)];

        // Etapa C: Análise de IA focada
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
    log(`Análise com tabela temporária concluída em ${duration}ms. Score: ${overallScore}%`);
    
    return result;

  } catch (err) {
    logError('Erro durante a análise de match com tabela temporária:', err.message);
    throw err;
  } finally {
    // 5. Limpeza (SEMPRE executa, mesmo se houver erro)
    if (profileTable) {
        await dropProfileVectorTable(tempTableName);
    }
  }
};