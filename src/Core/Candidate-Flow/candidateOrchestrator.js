import { createTalent, deleteTalent, updateTalent } from '../../Inhire/Talents/talents.service.js';
import { addTalentToJob, updateApplication } from '../../Inhire/JobTalents/jobTalents.service.js';
import { getCustomFieldsForEntity } from '../../Inhire/CustomDataManager/customDataManager.service.js';
import { mapProfileToInhireSchemaWithAI } from '../AI-Flow/aiOrchestrator.js'; 
import { getFromCache, setToCache, clearCacheByPrefix } from '../../utils/cache.service.js';
import { log, error } from '../../utils/logger.service.js';

const TALENTS_CACHE_KEY = 'all_talents';

/**
 * Helper para extrair o username de uma URL do LinkedIn de forma segura.
 * Ex: "https://www.linkedin.com/in/username/" -> "username"
 * @param {string} url - A URL do perfil.
 * @returns {string|null} O username extraído ou null.
 */
const extractUsernameFromUrl = (url) => {
    if (!url) return null;
    try {
        const urlObject = new URL(url);
        const pathParts = urlObject.pathname.split('/').filter(part => part !== '');
        if (pathParts[0] === 'in' && pathParts[1]) {
            return pathParts[1];
        }
        return null;
    } catch (e) {
        // Fallback para URLs que não são perfeitamente formadas
        const match = url.match(/linkedin\.com\/in\/([^/]+)/);
        return match ? match[1] : null;
    }
};

/**
 * ETAPA 1 DO FLUXO: VALIDA INSTANTANEAMENTE se o talento já existe no CACHE da InHire.
 * Esta função NÃO faz mais scraping.
 */
export const validateProfile = async (profileUrl) => {
  log(`--- ORQUESTRADOR: Iniciando VALIDAÇÃO OTIMIZADA (MAPA) para: ${profileUrl} ---`);
  try {
    const usernameToSearch = extractUsernameFromUrl(profileUrl);
    if (!usernameToSearch) {
        throw new Error("Não foi possível extrair um nome de usuário válido da URL do LinkedIn.");
    }

    // Usar o mapa de consulta em vez de percorrer o array.
    const talentLookupMap = getFromCache('talent_lookup_map');
    if (!talentLookupMap) {
        log("AVISO: Mapa de consulta de talentos (talent_lookup_map) ainda não está pronto. A validação pode ser mais lenta.");
        // Fallback para o método antigo se o mapa ainda não foi criado
        const allTalentsFromCache = getFromCache(TALENTS_CACHE_KEY) || [];
        const talentInCache = allTalentsFromCache.find(t => {
            const talentUsername = t.linkedinUsername ? t.linkedinUsername.toLowerCase().replace(/\/+$/, '') : null;
            return talentUsername === usernameToSearch.toLowerCase();
        });
        if (talentInCache) {
            log(`Validação (FALLBACK HIT): Talento "${talentInCache.name}" JÁ EXISTE.`);
            return { success: true, exists: true, talent: talentInCache, profileData: null };
        }
    } else {
        const normalizedSearch = usernameToSearch.toLowerCase();
        const talentInMap = talentLookupMap.get(normalizedSearch);

        if (talentInMap) {
            log(`Validação Otimizada (MAP HIT): Talento "${talentInMap.name}" JÁ EXISTE.`);
            return { success: true, exists: true, talent: talentInMap, profileData: null };
        }
    }

    log(`Validação Otimizada (MISS): Talento não encontrado na base.`);
    return { success: true, exists: false, talent: null, profileData: null };

  } catch (err) {
    error("Erro em validateProfile:", err.message);
    return { success: false, error: err.message };
  }
};

/**
 * ETAPA 2 DO FLUXO: Orquestração completa com MAPEAMENTO AUTÔNOMO E INTELIGENTE via IA.
 * Esta função é chamada DEPOIS que o frontend faz o scraping e envia os dados.
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

        // Invalidar o cache de candidatos para esta vaga específica.
        clearCacheByPrefix(`candidates_for_job_${jobId}`);

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

        // Limpa o payload do talento
        const cleanTalentPayload = {};
        if (mappedPayloads.talentPayload) {
            for (const [key, value] of Object.entries(mappedPayloads.talentPayload)) {
                if (value !== null && value !== undefined) {
                    cleanTalentPayload[key] = value;
                }
            }
        }

        // Limpa o payload da candidatura
        const cleanApplicationPayload = { customFields: [] };
        if (mappedPayloads.applicationPayload && Array.isArray(mappedPayloads.applicationPayload.customFields)) {
            cleanApplicationPayload.customFields = mappedPayloads.applicationPayload.customFields.filter(field => 
                field.value !== null && field.value !== undefined
            );
        }
        
        if (Object.keys(cleanTalentPayload).length > 0) {
            log("Atualizando talento com dados gerais mapeados e limpos pela IA:", cleanTalentPayload);
            await updateTalent(newTalent.id, cleanTalentPayload);
        } else {
            log("Nenhum dado geral do talento foi mapeado pela IA.");
        }

        if (cleanApplicationPayload.customFields.length > 0) {
            log("Atualizando candidatura com campos personalizados mapeados e limpos pela IA:", cleanApplicationPayload);
            await updateApplication(jobTalentId, cleanApplicationPayload);
        } else {
            log("Nenhum campo personalizado da candidatura foi mapeado pela IA.");
        }
        
        // ATUALIZAÇÃO DO CACHE EM TEMPO REAL
        const cachedTalents = getFromCache(TALENTS_CACHE_KEY) || [];
        const talentForCache = { id: newTalent.id, ...minimalPayload, ...cleanTalentPayload };
        cachedTalents.unshift(talentForCache);
        setToCache(TALENTS_CACHE_KEY, cachedTalents);
        log(`CACHE UPDATE: Novo talento '${newTalent.name}' adicionado ao cache.`);

        log("Processo de criação e preenchimento autônomo concluído com sucesso.");
        return { success: true, talent: newTalent, application: application };

    } catch(err) {
        error("Erro em handleConfirmCreation:", err.message);
        return { success: false, error: err.message };
    }
};

/**
 * Lida com a edição de dados de um talento existente.
 */
export const handleEditTalent = async (talentId, updateData) => {
  log(`--- ORQUESTRADOR: Editando talento ${talentId} ---`);
  try {
    if (!talentId || !updateData) {
      throw new Error("ID do talento e dados de atualização são obrigatórios.");
    }
    const success = await updateTalent(talentId, updateData);
    if (!success) {
      throw new Error("Falha ao atualizar talento na InHire.");
    }
    
    // ATUALIZAÇÃO DO CACHE EM TEMPO REAL
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

/**
 * Lida com a exclusão de um talento.
 */
export const handleDeleteTalent = async (talentId) => {
  log(`--- ORQUESTRADOR: Deletando talento ${talentId} ---`);
  try {
    const success = await deleteTalent(talentId);
    if (!success) {
      throw new Error("Falha ao excluir talento.");
    }
    
    // ATUALIZAÇÃO DO CACHE EM TEMPO REAL
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