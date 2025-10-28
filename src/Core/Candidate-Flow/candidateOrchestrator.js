// ARQUIVO COMPLETO: src/Core/Candidate-Flow/candidateOrchestrator.js

import { createTalent, deleteTalent, updateTalent } from '../../Inhire/Talents/talents.service.js';
import { addTalentToJob, updateApplication } from '../../Inhire/JobTalents/jobTalents.service.js';
import { getCustomFieldsForEntity } from '../../Inhire/CustomDataManager/customDataManager.service.js';
// Importa o novo mapeador de IA no lugar do antigo.
import { mapProfileToCustomFieldsWithAI } from './aiDataMapper.service.js';
import { getFromCache, setToCache, clearCacheByPrefix } from '../../utils/cache.service.js';
import { log, error } from '../../utils/logger.service.js';
import { saveCachedProfile } from '../../Platform/Cache/cache.service.js';

const TALENTS_CACHE_KEY = 'all_talents';

const extractUsernameFromUrl = (url) => {
    if (!url) return null;
    try {
        const urlObject = new URL(url);
        const pathParts = urlObject.pathname.split('/').filter(part => part !== '');
        if (pathParts[0] === 'in' && pathParts[1]) { return pathParts[1]; }
        return null;
    } catch (e) {
        const match = url.match(/linkedin\.com\/in\/([^/]+)/);
        return match ? match[1] : null;
    }
};

export const validateProfile = async (profileUrl) => {
  log(`--- ORQUESTRADOR: Iniciando VALIDAÇÃO OTIMIZADA (MAPA) para: ${profileUrl} ---`);
  try {
    const usernameToSearch = extractUsernameFromUrl(profileUrl);
    if (!usernameToSearch) {
        throw new Error("Não foi possível extrair um nome de usuário válido da URL do LinkedIn.");
    }
    const talentLookupMap = getFromCache('talent_lookup_map');
    if (talentLookupMap) {
        const talentInMap = talentLookupMap.get(usernameToSearch.toLowerCase());
        if (talentInMap) {
            log(`Validação Otimizada (MAP HIT): Talento "${talentInMap.name}" JÁ EXISTE.`);
            return { success: true, exists: true, talent: talentInMap, profileData: null };
        }
    } else {
        const allTalentsFromCache = getFromCache(TALENTS_CACHE_KEY) || [];
        const talentInCache = allTalentsFromCache.find(t => t.linkedinUsername?.toLowerCase().replace(/\/+$/, '') === usernameToSearch.toLowerCase());
        if (talentInCache) {
            log(`Validação (FALLBACK HIT): Talento "${talentInCache.name}" JÁ EXISTE.`);
            return { success: true, exists: true, talent: talentInCache, profileData: null };
        }
    }
    log(`Validação Otimizada (MISS): Talento não encontrado na base.`);
    return { success: true, exists: false, talent: null, profileData: null };
  } catch (err) {
    error("Erro em validateProfile:", err.message);
    return { success: false, error: err.message };
  }
};


export const handleConfirmCreation = async (talentData, jobId) => {
    log(`--- ORQUESTRADOR (IA-POWERED): Iniciando criação para '${talentData.name}' na vaga '${jobId}' ---`);
    try {
        if (!jobId) throw new Error("O ID da Vaga (jobId) é obrigatório.");

        // === PASSO 1: Criar o talento "esqueleto" com dados mínimos (rápido) ===
        const minimalPayload = { name: talentData.name, linkedinUsername: talentData.linkedinUsername, headline: talentData.headline };
        const newTalent = await createTalent(minimalPayload);
        if (!newTalent || !newTalent.id) throw new Error("A API da InHire falhou ao criar o talento base.");

        // === PASSO 2: Criar a candidatura (rápido) ===
        const application = await addTalentToJob(jobId, newTalent.id);
        if (!application || !application.id) throw new Error("Falha ao criar a candidatura (JobTalent).");
        
        // === PASSO 3: Mapeamento com IA em Alta Performance (rápido, < 4s) ===
        log("Iniciando mapeamento de campos personalizados com IA...");
        const jobTalentFieldsDefinitions = await getCustomFieldsForEntity('JOB_TALENTS');
        
        // Chame o novo serviço de IA.
        const { talentPayload, customFieldsPayload } = await mapProfileToCustomFieldsWithAI(talentData, jobTalentFieldsDefinitions);
        
        // === PASSO 4: Atualizar talento e candidatura com dados mapeados (rápido) ===
        // O `updateTalent` usa o `talentPayload` que contém mais dados (name, headline, company, etc.)
        await updateTalent(newTalent.id, talentPayload); 

        if (customFieldsPayload.length > 0) {
            await updateApplication(application.id, { customFields: customFieldsPayload });
        }
        log("Talento e candidatura atualizados com dados mapeados pela IA.");

        // === PASSO 5: Salvar no cache local para futuras análises (rápido) ===
        if (talentData.linkedinUsername) {
            await saveCachedProfile(talentData.linkedinUsername, talentData);
        }

        // === PASSO 6: Atualizar cache em memória para a UI (rápido) ===
        const cachedTalents = getFromCache(TALENTS_CACHE_KEY) || [];
        cachedTalents.unshift({ id: newTalent.id, ...talentPayload });
        setToCache(TALENTS_CACHE_KEY, cachedTalents);
        clearCacheByPrefix(`candidates_for_job_${jobId}`);

        log("🚀 Processo de criação e preenchimento com IA concluído com sucesso.");
        return { success: true, talent: newTalent, application: application };

    } catch(err) {
        error("Erro em handleConfirmCreation:", err.message);
        return { success: false, error: err.message };
    }
};

export const handleEditTalent = async (talentId, updateData) => {
  log(`--- ORQUESTRADOR: Editando talento ${talentId} ---`);
  try {
    if (!talentId || !updateData) throw new Error("ID do talento e dados de atualização são obrigatórios.");
    const success = await updateTalent(talentId, updateData);
    if (!success) throw new Error("Falha ao atualizar talento na InHire.");
    
    const cachedTalents = getFromCache(TALENTS_CACHE_KEY);
    if (cachedTalents) {
        const index = cachedTalents.findIndex(t => t.id === talentId);
        if (index !== -1) {
            cachedTalents[index] = { ...cachedTalents[index], ...updateData };
            setToCache(TALENTS_CACHE_KEY, cachedTalents);
            log(`CACHE UPDATE: Talento ID '${talentId}' atualizado no cache.`);
        }
    }
    return { success: true, message: "Talento atualizado com sucesso." };
  } catch (err) {
    error("Erro em handleEditTalent:", err.message);
    return { success: false, error: err.message };
  }
};

export const handleDeleteTalent = async (talentId) => {
  log(`--- ORQUESTRADOR: Deletando talento ${talentId} ---`);
  try {
    const success = await deleteTalent(talentId);
    if (!success) throw new Error("Falha ao excluir talento.");

    const cachedTalents = getFromCache(TALENTS_CACHE_KEY);
    if (cachedTalents) {
        const updatedCache = cachedTalents.filter(t => t.id !== talentId);
        setToCache(TALENTS_CACHE_KEY, updatedCache);
        log(`CACHE UPDATE: Talento ID '${talentId}' removido do cache.`);
    }
    return { success: true, message: "Talento excluído com sucesso." };
  } catch (err) {
    error("Erro em handleDeleteTalent:", err.message);
    return { success: false, error: err.message };
  }
};