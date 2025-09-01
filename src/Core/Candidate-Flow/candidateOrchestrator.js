// src/Core/Candidate-Flow/candidateOrchestrator.js

import { extractProfileData } from '../../Linkedin/profile.service.js';
import { findTalent, createTalent, deleteTalent, updateTalent } from '../../Inhire/Talents/talents.service.js';
import { addTalentToJob, updateApplication } from '../../Inhire/JobTalents/jobTalents.service.js';
import { STATIC_FIELD_MAPPING } from './customFieldMapping.js'; // NOVO: Importa o mapa estático inteligente
import { clearCacheByPrefix } from '../../utils/cache.service.js';
import { log, error } from '../../utils/logger.service.js';

/**
 * ETAPA 1 DO FLUXO: Extrai dados do perfil e VALIDA se o talento já existe na InHire.
 */
export const validateProfile = async (profileUrl) => {
  log(`--- ORQUESTRADOR: Iniciando VALIDAÇÃO para: ${profileUrl} ---`);
  try {
    const profileData = await extractProfileData(profileUrl);
    if (!profileData) throw new Error("Não foi possível extrair dados do perfil via Phantombuster.");
    const usernameToSearch = profileData.linkedinUsername;
    let talentInHire = null;
    if (usernameToSearch) {
      talentInHire = await findTalent({ linkedinUsername: usernameToSearch });
    } else {
      log("AVISO: linkedinUsername não disponível para busca de talento existente.");
    }
    if (talentInHire) {
      log(`Validação concluída: Talento "${profileData.name}" JÁ EXISTE na InHire.`);
      return { success: true, exists: true, talent: talentInHire, profileData: profileData };
    } else {
      log(`Validação concluída: Talento "${profileData.name}" NÃO EXISTE na InHire.`);
      return { success: true, exists: false, talent: null, profileData: profileData };
    }
  } catch (err) {
    error("Erro em validateProfile:", err.message);
    return { success: false, error: err.message };
  }
};

/**
 * ETAPA 2 DO FLUXO: Orquestração completa com MAPEAMENTO ESTÁTICO E INTELIGENTE.
 */
export const handleConfirmCreation = async (talentData, jobId) => {
    log(`--- ORQUESTRADOR: Iniciando criação com MAPEAMENTO INTELIGENTE para '${talentData.name}' na vaga '${jobId}' ---`);
    try {
        if (!jobId) throw new Error("O ID da Vaga (jobId) é obrigatório para o fluxo de criação.");

        // === PASSO 1: Criar o talento com os dados básicos ===
        log("Passo 1/3: Criando talento com dados básicos...");
        const initialPayload = { name: talentData.name, linkedinUsername: talentData.linkedinUsername };
        if (talentData.linkedinHeadline) initialPayload.headline = talentData.linkedinHeadline;
        if (talentData.location) initialPayload.location = talentData.location;
        if (talentData.companyName) initialPayload.company = talentData.companyName;
        const newTalent = await createTalent(initialPayload);
        if (!newTalent || !newTalent.id) throw new Error("A API da InHire falhou ao criar o talento base.");
        log(`Talento base criado com sucesso. ID: ${newTalent.id}`);

        // === PASSO 2: Criar a candidatura (JobTalent) ===
        log("Passo 2/3: Criando a candidatura (JobTalent)...");
        const application = await addTalentToJob(jobId, newTalent.id);
        if (!application || !application.id) throw new Error("Falha ao criar a candidatura (JobTalent).");
        const jobTalentId = application.id;
        log(`Candidatura criada com sucesso. JobTalent ID: ${jobTalentId}`);

        // === PASSO 3: Mapeamento inteligente e atualização ===
        log("Passo 3/3: Processando mapeamentos de campos personalizados...");
        
        const promises = Object.entries(STATIC_FIELD_MAPPING).map(async ([fieldId, mapping]) => {
            try {
                // A função `transform` pode ser síncrona ou assíncrona
                const value = await Promise.resolve(mapping.transform(talentData));
                
                // Adiciona ao payload apenas se a transformação retornar um valor válido
                // (não nulo, não undefined e, para strings, não vazias)
                if (value !== null && value !== undefined && value !== "") {
                    log(`- Mapeado: Campo ID '${fieldId}' receberá o valor: ${JSON.stringify(value)}`);
                    return {
                        id: fieldId,
                        type: mapping.type,
                        value: value
                    };
                }
            } catch (transformErr) {
                error(`Erro ao transformar o campo ID '${fieldId}'`, transformErr.message);
            }
            return null; // Retorna null se não houver valor ou se ocorrer um erro
        });

        // Aguarda todas as transformações e filtra os resultados nulos
        const customFieldsToUpdate = (await Promise.all(promises)).filter(field => field !== null);

        if (customFieldsToUpdate.length > 0) {
            const updatePayload = { customFields: customFieldsToUpdate };
            log("Enviando payload de atualização para a candidatura:", JSON.stringify(updatePayload, null, 2));
            const updatedApp = await updateApplication(jobTalentId, updatePayload);
            if (!updatedApp) {
                log(`AVISO: O talento e a candidatura foram criados, mas a atualização com campos personalizados falhou.`);
            } else {
                log("Campos personalizados foram preenchidos e atualizados com sucesso via candidatura.");
            }
        } else {
            log("Nenhum dado do scraping correspondeu a um campo personalizado configurado para preenchimento automático.");
        }

        clearCacheByPrefix('talents_page_');
        return { success: true, talent: newTalent, application: application };

    } catch(err) {
        error("Erro em handleConfirmCreation:", err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Lida com a edição de dados de um talento existente.
 * @param {string} talentId - O ID do talento a ser editado.
 * @param {object} updateData - Os dados a serem atualizados no talento (ex: { name: "Novo Nome" }).
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const handleEditTalent = async (talentId, updateData) => {
  log(`--- ORQUESTRADOR: Editando talento ${talentId} com dados: ${JSON.stringify(updateData)} ---`);
  try {
    if (!talentId || !updateData) {
      throw new Error("ID do talento e dados de atualização são obrigatórios.");
    }
    const success = await updateTalent(talentId, updateData);
    if (!success) {
      throw new Error("Falha ao atualizar talento na InHire.");
    }
    clearCacheByPrefix('talents_page_');
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
    clearCacheByPrefix('talents_page_');
    return { success: true, message: "Talento excluído com sucesso." };
  } catch (err) {
    error("Erro em handleDeleteTalent:", err.message);
    return { success: false, error: err.message };
  }
};