// src/Core/Candidate-Flow/candidateOrchestrator.js

import { extractProfileData } from '../../Linkedin/profile.service.js';
import { findTalent, createTalent, deleteTalent, updateTalent } from '../../Inhire/Talents/talents.service.js';
import { addTalentToJob, updateApplication } from '../../Inhire/JobTalents/jobTalents.service.js';
import { getCustomFieldsForEntity } from '../../Inhire/CustomDataManager/customDataManager.service.js';
import { mapProfileToInhireSchemaWithAI } from '../AI-Flow/aiOrchestrator.js'; 
import { getFromCache, setToCache } from '../../utils/cache.service.js';


const TALENTS_PAGE_1_CACHE_KEY = 'talents_page_1';

/**
 * ETAPA 1 DO FLUXO: Extrai dados do perfil e VALIDA se o talento já existe na InHire.
 */
export const validateProfile = async (profileUrl) => {
  log(`--- ORQUESTRADOR: Iniciando VALIDAÇÃO OTIMIZADA para: ${profileUrl} ---`);
  try {
    // 1. Extrai o username diretamente da URL (instantâneo).
    const usernameToSearch = extractUsernameFromUrl(profileUrl);
    if (!usernameToSearch) {
        throw new Error("Não foi possível extrair um nome de usuário válido da URL do LinkedIn.");
    }

    // 2. Busca na lista de talentos já cacheada.
    const allTalentsFromCache = getFromCache(TALENTS_CACHE_KEY) || [];
    const talentInCache = allTalentsFromCache.find(t => {
        const talentUsername = t.linkedinUsername ? t.linkedinUsername.toLowerCase().replace(/\/+$/, '') : null;
        return talentUsername === usernameToSearch.toLowerCase();
    });

    // 3. Se o talento for encontrado no cache, o processo para AQUI.
    if (talentInCache) {
      log(`Validação Otimizada (CACHE HIT): Talento "${talentInCache.name}" JÁ EXISTE. Scraping evitado.`);
      // Retornamos os dados do talento do cache, sem precisar de `profileData` do scraper.
      return { success: true, exists: true, talent: talentInCache, profileData: null };
    }

    // 4. Se NÃO for encontrado, SÓ AGORA iniciamos o scraping.
    log(`Validação Otimizada (CACHE MISS): Talento não encontrado. Iniciando scraping...`);
    const profileData = await extractProfileData(profileUrl);
    if (!profileData) {
      throw new Error("O perfil não foi encontrado no cache e o scraping falhou.");
    }
    
    log(`Validação Otimizada: Scraping concluído. Talento "${profileData.name}" NÃO EXISTE na base.`);
    return { success: true, exists: false, talent: null, profileData: profileData };

  } catch (err) {
    error("Erro em validateProfile:", err.message);
    return { success: false, error: err.message };
  }
};

/**
 * ETAPA 2 DO FLUXO: Orquestração completa com MAPEAMENTO AUTÔNOMO E INTELIGENTE via IA.
 */
export const handleConfirmCreation = async (talentData, jobId) => {
    log(`--- ORQUESTRADOR: Iniciando criação com MAPEAMENTO AUTÔNOMO para '${talentData.name}' na vaga '${jobId}' ---`);
    try {
        if (!jobId) throw new Error("O ID da Vaga (jobId) é obrigatório para o fluxo de criação.");

        // === PASSO 1: Criar o talento "esqueleto" com o mínimo absoluto ===
        log("Passo 1/4: Criando talento com dados mínimos...");
        const minimalPayload = {
            name: talentData.name,
            linkedinUsername: talentData.linkedinUsername,
            headline: talentData.headline
        };
        const newTalent = await createTalent(minimalPayload);
        if (!newTalent || !newTalent.id) throw new Error("A API da InHire falhou ao criar o talento base.");
        log(`Talento base criado com sucesso. ID: ${newTalent.id}`);

        // === PASSO 2: Criar a candidatura para vincular o talento à vaga ===
        log("Passo 2/4: Criando a candidatura (JobTalent)...");
        const application = await addTalentToJob(jobId, newTalent.id);
        if (!application || !application.id) throw new Error("Falha ao criar a candidatura (JobTalent).");
        const jobTalentId = application.id;
        log(`Candidatura criada com sucesso. JobTalent ID: ${jobTalentId}`);

        // === PASSO 3: Coletar as "ferramentas" para a IA ===
        log("Passo 3/4: Coletando schemas da InHire para o briefing da IA...");
        const jobTalentFields = await getCustomFieldsForEntity('JOB_TALENTS');

        const talentGeneralFields = [
            { name: 'location', type: 'text', description: 'A cidade/estado/país do candidato.' },
            { name: 'company', type: 'text', description: 'O nome da empresa atual do candidato.' },
            { name: 'email', type: 'text', description: 'O email de contato principal.' },
            { name: 'phone', type: 'text', description: 'O telefone de contato principal.' }
        ];

        // === PASSO 4: Chamar a IA com o briefing completo e executar as atualizações ===
        log("Passo 4/4: Enviando dossiê e schemas para a IA e executando atualizações...");
        const mappedPayloads = await mapProfileToInhireSchemaWithAI(talentData, talentGeneralFields, jobTalentFields);

        const { talentPayload, applicationPayload } = mappedPayloads;

        if (talentPayload && Object.keys(talentPayload).length > 0) {
            log("Atualizando talento com dados gerais mapeados pela IA:", talentPayload);
            await updateTalent(newTalent.id, talentPayload);
        }

        if (applicationPayload && applicationPayload.customFields && applicationPayload.customFields.length > 0) {
            log("Atualizando candidatura com campos personalizados mapeados pela IA:", applicationPayload);
            await updateApplication(jobTalentId, applicationPayload);
        }
        
        // <<< ATUALIZAÇÃO DO CACHE EM TEMPO REAL >>>
        const cachedTalentsData = getFromCache(TALENTS_PAGE_1_CACHE_KEY);
        if (cachedTalentsData && cachedTalentsData.talents) {
            cachedTalentsData.talents.unshift(newTalent); // Adiciona o novo talento no início da lista
            setToCache(TALENTS_PAGE_1_CACHE_KEY, cachedTalentsData);
            log(`CACHE UPDATE: Novo talento '${newTalent.name}' adicionado ao cache da página 1.`);
        }
        
        log("Processo de criação e preenchimento autônomo concluído com sucesso.");
        return { success: true, talent: newTalent, application: application };

    } catch(err) {
        error("Erro em handleConfirmCreation:", err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Lida com a edição de dados de um talento existente.
 * @param {string} talentId - O ID do talento a ser editado.
 * @param {object} updateData - Os dados a serem atualizados no talento.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const handleEditTalent = async (talentId, updateData) => {
  log(`--- ORQUESTRADOR: Editando talento ${talentId} com dados: ${JSON.stringify(updateData)} ---`);
  try {
    if (!talentId || !updateData) {
      throw new Error("ID do talento e dados de atualização são obrigatórios.");
    }
    // A API de update da InHire não retorna o objeto completo, então fazemos o update primeiro
    const success = await updateTalent(talentId, updateData);
    if (!success) {
      throw new Error("Falha ao atualizar talento na InHire.");
    }
    
    // <<< ATUALIZAÇÃO DO CACHE EM TEMPO REAL >>>
    const cachedTalentsData = getFromCache(TALENTS_PAGE_1_CACHE_KEY);
    if (cachedTalentsData && cachedTalentsData.talents) {
        const index = cachedTalentsData.talents.findIndex(t => t.id === talentId);
        if (index !== -1) {
            // Mescla os dados antigos com os novos para manter a consistência
            cachedTalentsData.talents[index] = { ...cachedTalentsData.talents[index], ...updateData };
            setToCache(TALENTS_PAGE_1_CACHE_KEY, cachedTalentsData);
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
    if (!success) {
      return { success: false, error: "Falha ao excluir talento." };
    }
    
    // <<< ATUALIZAÇÃO DO CACHE EM TEMPO REAL >>>
    const cachedTalentsData = getFromCache(TALENTS_PAGE_1_CACHE_KEY);
    if (cachedTalentsData && cachedTalentsData.talents) {
        const initialLength = cachedTalentsData.talents.length;
        const updatedTalents = cachedTalentsData.talents.filter(t => t.id !== talentId);
        if (updatedTalents.length < initialLength) {
            cachedTalentsData.talents = updatedTalents;
            setToCache(TALENTS_PAGE_1_CACHE_KEY, cachedTalentsData);
            log(`CACHE UPDATE: Talento ID '${talentId}' removido do cache.`);
        }
    }

    return { success: true, message: "Talento excluído com sucesso." };
  } catch (err) {
    error("Erro em handleDeleteTalent:", err.message);
    return { success: false, error: err.message };
  }
};