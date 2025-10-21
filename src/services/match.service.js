import { findById as findScorecardById } from './scorecard.service.js';
import { createEmbeddings } from './embedding.service.js';
import { analyzeCriterionWithAI } from './ai.service.js';
import { log, error } from '../utils/logger.service.js';

/**
 * Quebra o perfil em pedaços de texto significativos para análise de similaridade.
 * Cada pedaço representa um contexto semântico.
 * @param {object} profileData - O objeto JSON completo dos dados do perfil do LinkedIn.
 * @returns {string[]} Um array de textos (chunks) representando o perfil.
 */
const chunkProfile = (profileData) => {
  const chunks = [];
  // Adiciona os campos de alto nível primeiro
  if (profileData.headline) chunks.push(`Título: ${profileData.headline}`);
  if (profileData.about) chunks.push(`Sobre: ${profileData.about}`);
  if (profileData.skills && profileData.skills.length > 0) {
    chunks.push(`Competências listadas: ${profileData.skills.join(', ')}`);
  }
  // Adiciona cada experiência profissional como um chunk separado para análise granular
  if (profileData.experience) {
    profileData.experience.forEach(exp => {
      // Combina título, empresa e descrição para criar um contexto rico
      const experienceText = `Experiência: ${exp.title} na ${exp.companyName}. ${exp.description || ''}`;
      chunks.push(experienceText.trim());
    });
  }
  // Adiciona educação como contexto adicional
  if (profileData.education) {
    profileData.education.forEach(edu => {
      chunks.push(`Educação: ${edu.degree} em ${edu.schoolName}.`);
    });
  }
  return chunks.filter(Boolean); // Garante que não haja chunks vazios ou nulos
};

/**
 * Calcula a similaridade de cosseno entre dois vetores. É a base da comparação semântica.
 * @param {number[]} vecA - O primeiro vetor de embedding.
 * @param {number[]} vecB - O segundo vetor de embedding.
 * @returns {number} A similaridade, um valor entre -1 e 1 (geralmente 0 a 1 para embeddings).
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0; // Retorna 0 se os vetores forem inválidos
  }
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0; // Evita divisão por zero
  return dotProduct / denominator;
}

/**
 * Encontra os trechos de texto mais relevantes de um perfil para um dado critério,
 * calculando a similaridade em JavaScript e retornando os melhores.
 * @param {number[]} criterionEmbedding - O vetor do critério a ser comparado.
 * @param {string[]} profileChunks - Os textos do perfil.
 * @param {number[][]} profileEmbeddings - Os vetores correspondentes aos textos do perfil.
 * @param {number} [topK=3] - O número de chunks mais relevantes a serem retornados.
 * @returns {string[]} Um array com os 'topK' textos mais similares.
 */
function findRelevantChunks(criterionEmbedding, profileChunks, profileEmbeddings, topK = 3) {
    const similarities = profileEmbeddings.map((profileVec, index) => ({
        index,
        similarity: cosineSimilarity(criterionEmbedding, profileVec)
    }));
    
    // Ordena os chunks pela maior similaridade
    similarities.sort((a, b) => b.similarity - a.similarity);
    
    // Retorna o texto dos 'topK' chunks mais similares
    return similarities.slice(0, topK).map(item => profileChunks[item.index]);
}

/**
 * Orquestra a análise de match instantânea (cálculo em JS) para um perfil
 * contra um scorecard, retornando uma avaliação ponderada e detalhada.
 * @param {string} scorecardId - O ID do scorecard a ser usado para a análise.
 * @param {object} profileData - Os dados brutos do perfil scrapeado.
 * @returns {Promise<object>} O resultado completo da análise de match.
 */
export const analyze = async (scorecardId, profileData) => {
  const startTime = Date.now();
  log(`Iniciando análise (JS-based) para "${profileData.name}" com scorecard ${scorecardId}`);

  try {
    // 1. Carrega o scorecard completo do cache/banco, incluindo embeddings
    const scorecard = await findScorecardById(scorecardId);
    if (!scorecard) {
      throw new Error('Scorecard não encontrado.');
    }

    // 2. Prepara os dados do perfil, quebrando em pedaços e gerando embeddings
    const profileChunks = chunkProfile(profileData);
    if (profileChunks.length === 0) {
      throw new Error('O perfil não contém texto analisável para gerar embeddings.');
    }
    const profileEmbeddings = await createEmbeddings(profileChunks);

    const categoryResults = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;

    // 3. Itera sobre cada categoria e seus critérios para avaliação
    for (const category of scorecard.categories) {
      const criteriaEvaluations = [];
      let categoryWeightedScore = 0;
      let categoryTotalWeight = 0;

      // Cria um array de promises para executar as análises de IA em paralelo,
      // maximizando a performance.
      const analysisPromises = category.criteria.map(async (criterion) => {
        if (!criterion.embedding) {
          log(`AVISO: Critério "${criterion.name}" no scorecard ${scorecardId} não possui embedding. Pulando.`);
          return null; // Pula critérios sem embedding
        }
        
        // Encontra o contexto mais relevante para este critério
        const relevantChunks = findRelevantChunks(criterion.embedding, profileChunks, profileEmbeddings);
        
        // Chama a IA para uma avaliação focada e rápida
        const evaluation = await analyzeCriterionWithAI(criterion, relevantChunks);
        
        return { evaluation, weight: criterion.weight };
      });

      // Aguarda a finalização de todas as análises de IA para a categoria
      const resolvedEvaluations = await Promise.all(analysisPromises);
      
      // 4. Calcula as pontuações ponderadas para a categoria
      resolvedEvaluations.forEach(result => {
        if (result) {
          criteriaEvaluations.push(result.evaluation);
          categoryWeightedScore += result.evaluation.score * result.weight;
          categoryTotalWeight += 5 * result.weight; // A nota máxima (5) multiplicada pelo peso
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

    // 5. Calcula a pontuação geral final
    const overallScore = totalWeight > 0 ? Math.round((totalWeightedScore / totalWeight) * 100) : 0;

    const result = {
      overallScore,
      profileName: profileData.name,
      profileHeadline: profileData.headline,
      categories: categoryResults,
    };

    const duration = Date.now() - startTime;
    log(`Análise (JS-based) concluída para "${profileData.name}" em ${duration}ms. Score final: ${overallScore}%`);
    
    return result;

  } catch (err) {
    error('Erro crítico durante a análise de match (JS-based):', err.message);
    throw err; // Lança o erro para ser tratado pelo controller
  }
};