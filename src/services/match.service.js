// ARQUIVO COMPLETO, FINAL E ULTRA-OTIMIZADO: src/services/match.service.js

import { findById as findScorecardById } from './scorecard.service.js';
import { createEmbeddings } from './embedding.service.js';
import { analyzeWithPreFilteredEvidence } from './ai.service.js';
import { searchSimilarVectors } from './vector.service.js';
import { getGenericCache, setGenericCache } from '../Platform/Storage/localCache.service.js';
import { log, error as logError } from '../utils/logger.service.js';
import crypto from 'crypto';

// Helper para criar um hash do conteúdo do perfil para usar como chave de cache
const createProfileHash = (profileData) => {
    const profileString = JSON.stringify(profileData);
    return crypto.createHash('sha256').update(profileString).digest('hex');
};

// Helper para dividir o perfil em pedaços de texto (chunks)
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
  log(`Iniciando análise ULTRA-OTIMIZADA para "${profileData.name}"`);
  
  try {
    const scorecard = await findScorecardById(scorecardId);
    if (!scorecard) throw new Error('Scorecard não encontrado.');
    if (!profileData) throw new Error('Dados do perfil não fornecidos.');
    
    // --- ETAPA 1: CACHE DE EMBEDDINGS DO PERFIL ---
    const profileHash = createProfileHash(profileData);
    const embeddingsCacheKey = `embeddings_${profileHash}`;
    let profileEmbeddings = await getGenericCache(embeddingsCacheKey);
    let profileChunks;

    if (profileEmbeddings) {
        log(`CACHE HIT: Embeddings do perfil encontrados no cache.`);
        profileChunks = chunkProfile(profileData); // Chunks ainda precisam ser gerados
    } else {
        log(`CACHE MISS: Embeddings do perfil não encontrados. Gerando e salvando...`);
        profileChunks = chunkProfile(profileData);
        if (profileChunks.length === 0) throw new Error('Perfil não contém texto analisável.');
        
        profileEmbeddings = await createEmbeddings(profileChunks);
        await setGenericCache(embeddingsCacheKey, profileEmbeddings); // Salva no cache para a próxima vez
    }

    // --- ETAPA 2: MAPEAMENTO DE EVIDÊNCIAS (BUSCA VETORIAL) ---
    const evidenceMap = new Map();
    const searchPromises = profileEmbeddings.map(async (profileVector, index) => {
        const profileChunkText = profileChunks[index];
        const searchResults = await searchSimilarVectors(profileVector, 2);
        
        searchResults.forEach(result => {
            const criterionId = result.uuid;
            if (!evidenceMap.has(criterionId)) {
                evidenceMap.set(criterionId, new Set()); // Usa um Set para evitar duplicatas
            }
            evidenceMap.get(criterionId).add(profileChunkText);
        });
    });
    await Promise.all(searchPromises);

    // Converte o mapa de Sets para um mapa de Arrays, associando pelo nome do critério
    const finalEvidenceMap = new Map();
    scorecard.categories.forEach(cat => {
        (cat.criteria || []).forEach(crit => {
            const evidences = evidenceMap.get(crit.id);
            finalEvidenceMap.set(crit.name, evidences ? Array.from(evidences) : []);
        });
    });

    // --- ETAPA 3: ANÁLISE "SINGLE-SHOT" COM EVIDÊNCIAS ---
    const result = await analyzeWithPreFilteredEvidence(scorecard, finalEvidenceMap);

    const duration = Date.now() - startTime;
    log(`Análise ULTRA-OTIMIZADA concluída em ${duration}ms. Score: ${result.overallScore}%`);
    
    return {
        ...result,
        profileName: profileData.name,
        profileHeadline: profileData.headline
    };

  } catch (err) {
    // Log aprimorado para capturar qualquer tipo de erro
    logError('Erro durante a análise ULTRA-OTIMIZADA:', err);
    
    // Cria um novo erro com uma mensagem clara, preservando a causa original.
    const newError = new Error(err.message || 'Ocorreu um erro indefinido durante a análise de match.');
    newError.stack = err.stack; // Preserva o stack trace
    throw newError;
  }
};