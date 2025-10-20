// CRIE O ARQUIVO: src/Core/Candidate-Flow/updateOrchestrator.js

import { updateTalent } from '../../Inhire/Talents/talents.service.js';
import { updateApplication } from '../../Inhire/JobTalents/jobTalents.service.js';
import { getCustomFieldsForEntity } from '../../Inhire/CustomDataManager/customDataManager.service.js';
import { mapProfileToInhireSchemaWithAI } from '../AI-Flow/aiOrchestrator.js'; 
import { getFromCache, setToCache } from '../../utils/cache.service.js';
import { log, error } from '../../utils/logger.service.js';

const TALENTS_CACHE_KEY = 'all_talents';

/**
 * Orquestra a atualização completa de um talento e sua candidatura a partir de novos dados do LinkedIn.
 * @param {string} talentId - O ID do talento a ser atualizado.
 * @param {string} applicationId - O ID da candidatura a ser atualizada.
 * @param {object} scrapedData - Os novos dados brutos vindos do scraping.
 */
export const handleFullProfileUpdate = async (talentId, applicationId, scrapedData) => {
    log(`--- UPDATE ORCHESTRATOR: Iniciando atualização completa para Talento ID: ${talentId} ---`);
    try {
        // Passo 1: Coletar schemas da InHire para o briefing da IA
        log("Passo 1/3: Coletando schemas da InHire...");
        const jobTalentFields = await getCustomFieldsForEntity('JOB_TALENTS');
        const talentGeneralFields = [
            { name: 'location', type: 'text', description: 'A cidade/estado/país do candidato.' },
            { name: 'company', type: 'text', description: 'O nome da empresa atual do candidato.' },
            { name: 'email', type: 'text', description: 'O email de contato principal.' },
            { name: 'phone', type: 'text', description: 'O telefone de contato principal.' },
            { name: 'headline', type: 'text', description: 'O título profissional do candidato.' },
            { name: 'name', type: 'text', description: 'O nome completo do candidato.' }
        ];

        // Passo 2: Chamar a IA para re-mapear os novos dados
        log("Passo 2/3: Enviando novos dados para a IA re-mapear...");
        const mappedPayloads = await mapProfileToInhireSchemaWithAI(scrapedData, talentGeneralFields, jobTalentFields);

        // Limpeza de valores nulos/undefined
        const cleanTalentPayload = {};
        if (mappedPayloads.talentPayload) {
            for (const [key, value] of Object.entries(mappedPayloads.talentPayload)) {
                if (value !== null && value !== undefined) { cleanTalentPayload[key] = value; }
            }
        }
        const cleanApplicationPayload = { customFields: [] };
        if (mappedPayloads.applicationPayload && Array.isArray(mappedPayloads.applicationPayload.customFields)) {
            cleanApplicationPayload.customFields = mappedPayloads.applicationPayload.customFields.filter(field => 
                field.value !== null && field.value !== undefined
            );
        }

        // Passo 3: Executar as atualizações
        log("Passo 3/3: Executando atualizações na API InHire...");
        if (Object.keys(cleanTalentPayload).length > 0) {
            await updateTalent(talentId, cleanTalentPayload);
            log(`Talento ${talentId} atualizado com ${Object.keys(cleanTalentPayload).length} campos.`);
        }
        if (cleanApplicationPayload.customFields.length > 0) {
            await updateApplication(applicationId, cleanApplicationPayload);
            log(`Candidatura ${applicationId} atualizada com ${cleanApplicationPayload.customFields.length} campos personalizados.`);
        }

        // Atualização do cache de talentos
        const cachedTalents = getFromCache(TALENTS_CACHE_KEY);
        if (cachedTalents) {
            const index = cachedTalents.findIndex(t => t.id === talentId);
            if (index !== -1) {
                // Atualiza o objeto no cache com os novos dados
                cachedTalents[index] = { ...cachedTalents[index], ...cleanTalentPayload };
                setToCache(TALENTS_CACHE_KEY, cachedTalents);
                log(`CACHE UPDATE: Talento ID '${talentId}' atualizado no cache.`);
            }
        }

        log(`Atualização completa para o talento ${talentId} concluída com sucesso.`);
        return { success: true, message: 'Talento e candidatura atualizados com sucesso.' };

    } catch (err) {
        error("Erro em handleFullProfileUpdate:", err.message);
        return { success: false, error: err.message };
    }
};