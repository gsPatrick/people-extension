// src/Core/Candidate-Flow/candidateOrchestrator.js

import { extractProfileData } from '../../Linkedin/profile.service.js';
import { findTalent, createTalent, deleteTalent, updateTalent } from '../../Inhire/Talents/talents.service.js';
import { addTalentToJob, updateApplication } from '../../Inhire/JobTalents/jobTalents.service.js';
import { getCustomFieldsForEntity } from '../../Inhire/CustomDataManager/customDataManager.service.js';
import { mapProfileToInhireSchemaWithAI } from '../AI-Flow/aiOrchestrator.js'; 
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

        // Definimos os campos gerais que sabemos que a API de talento aceita na ATUALIZAÇÃO
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

        // Atualiza o talento com os campos gerais que a IA encontrou
        if (talentPayload && Object.keys(talentPayload).length > 0) {
            log("Atualizando talento com dados gerais mapeados pela IA:", talentPayload);
            await updateTalent(newTalent.id, talentPayload);
        }

        // Atualiza a candidatura com os campos personalizados
        if (applicationPayload && applicationPayload.customFields && applicationPayload.customFields.length > 0) {
            log("Atualizando candidatura com campos personalizados mapeados pela IA:", applicationPayload);
            await updateApplication(jobTalentId, applicationPayload);
        }
        
        log("Processo de criação e preenchimento autônomo concluído com sucesso.");
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