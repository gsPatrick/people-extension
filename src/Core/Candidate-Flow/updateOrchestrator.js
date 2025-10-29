// ATUALIZE O ARQUIVO: src/Core/Candidate-Flow/updateOrchestrator.js

import { updateTalent } from '../../Inhire/Talents/talents.service.js';
import { updateApplication } from '../../Inhire/JobTalents/jobTalents.service.js';
import { getCustomFieldsForEntity } from '../../Inhire/CustomDataManager/customDataManager.service.js';
import { mapProfileToCustomFieldsWithAI } from './aiDataMapper.service.js'; 
import { getFromCache, setToCache } from '../../utils/cache.service.js';
import { log, error } from '../../utils/logger.service.js';
import { saveCachedProfile } from '../../Platform/Cache/cache.service.js';

const TALENTS_CACHE_KEY = 'all_talents';

/**
 * Orquestra a atualização completa de um talento e sua candidatura a partir de novos dados do LinkedIn.
 * AGORA USANDO MAPEAMENTO COM IA.
 */
export const handleFullProfileUpdate = async (talentId, applicationId, scrapedData) => {
    log(`--- UPDATE ORCHESTRATOR (IA): Iniciando atualização para Talento ID: ${talentId}, Candidatura ID: ${applicationId} ---`);
    try {
        if (!talentId || !applicationId || !scrapedData) {
            throw new Error('Os campos talentId, applicationId e scrapedData são obrigatórios.');
        }

        log("Passo 1/3: Mapeando novos dados do perfil com IA de alta performance...");
        const jobTalentFieldsDefinitions = await getCustomFieldsForEntity('JOB_TALENTS');
        const { talentPayload, customFieldsPayload } = await mapProfileToCustomFieldsWithAI(scrapedData, jobTalentFieldsDefinitions);
        
        // --- INÍCIO DA CORREÇÃO DE LOGS ---
        // Garante que os payloads finais (limpos de nulos/undefined) sejam logados
        const cleanTalentPayload = {};
        if (talentPayload) {
            for (const [key, value] of Object.entries(talentPayload)) {
                if (value !== null && value !== undefined) { cleanTalentPayload[key] = value; }
            }
        }
        // customFieldsPayload já deve vir filtrado pelo aiDataMapper, mas fazemos uma verificação extra
        const cleanCustomFieldsPayload = Array.isArray(customFieldsPayload) ? customFieldsPayload.filter(field => 
            field.value !== null && field.value !== undefined
        ) : [];

        log('==================== PAYLOADS DE ATUALIZAÇÃO PARA A API (IA) ====================');
        log('Payload do Talento (Limpo):', JSON.stringify(cleanTalentPayload, null, 2));
        log('Payload de Campos Personalizados (Limpo):', JSON.stringify(cleanCustomFieldsPayload, null, 2));
        log('================================================================================');
        // --- FIM DA CORREÇÃO DE LOGS ---

        // Passo 2: Executar as atualizações
        log("Passo 2/3: Executando atualizações na API InHire...");
        
        let talentUpdateSuccess = false;
        if (Object.keys(cleanTalentPayload).length > 0) {
            const result = await updateTalent(talentId, cleanTalentPayload);
            if (!result) { // updateTalent retorna true ou false
                throw new Error("Falha ao atualizar o talento na InHire.");
            }
            talentUpdateSuccess = true;
            log(`Talento ${talentId} atualizado com ${Object.keys(cleanTalentPayload).length} campos.`);
        } else {
            log(`Talento ${talentId}: Nenhum campo para atualizar.`);
        }

        let applicationUpdateSuccess = false;
        if (cleanCustomFieldsPayload.length > 0) {
            // É CRÍTICO que applicationId esteja correto aqui.
            const result = await updateApplication(applicationId, { customFields: cleanCustomFieldsPayload });
            if (!result) { // updateApplication retorna o objeto atualizado ou null
                // Este é o ponto onde o erro "Job talent not found" é mais provável de ser capturado
                throw new Error("Falha ao atualizar os campos personalizados da candidatura. ID da candidatura pode estar incorreto ou não encontrado.");
            }
            applicationUpdateSuccess = true;
            log(`Candidatura ${applicationId} atualizada com ${cleanCustomFieldsPayload.length} campos personalizados.`);
        } else {
            log(`Candidatura ${applicationId}: Nenhum campo personalizado para atualizar.`);
        }

        // Se ambos os updates não foram necessários ou foram bem-sucedidos
        if (!talentUpdateSuccess && !applicationUpdateSuccess && Object.keys(cleanTalentPayload).length === 0 && cleanCustomFieldsPayload.length === 0) {
            log(`Nenhuma atualização necessária para o talento ${talentId} ou candidatura ${applicationId}.`);
            return { success: true, message: 'Nenhuma atualização necessária.' };
        }


        // Passo 3: Atualizar caches
        log("Passo 3/3: Atualizando caches...");
        if (scrapedData.linkedinUsername) {
            await saveCachedProfile(scrapedData.linkedinUsername, scrapedData);
            log(`Perfil de "${scrapedData.linkedinUsername}" salvo/atualizado no cache SQLite.`);
        } else {
            log("Nenhum username do LinkedIn para salvar no cache de perfil.");
        }

        const cachedTalents = getFromCache(TALENTS_CACHE_KEY);
        if (cachedTalents && Object.keys(cleanTalentPayload).length > 0) { // Atualiza cache de talentos apenas se houver payload
            const index = cachedTalents.findIndex(t => t.id === talentId);
            if (index !== -1) {
                // Certifica-se de que estamos atualizando as propriedades que foram de fato modificadas
                cachedTalents[index] = { ...cachedTalents[index], ...cleanTalentPayload };
                setToCache(TALENTS_CACHE_KEY, cachedTalents);
                log(`CACHE UPDATE: Talento ID '${talentId}' atualizado no cache em memória.`);
            } else {
                log(`CACHE WARNING: Talento ID '${talentId}' não encontrado no cache em memória para atualização.`);
            }
        } else if (!cachedTalents) {
            log("CACHE WARNING: Cache de talentos não encontrado para atualização.");
        }

        log(`Atualização completa (IA) para o talento ${talentId} concluída com sucesso.`);
        return { success: true, message: 'Talento e candidatura atualizados com sucesso via IA.' };

    } catch (err) {
        // Captura o erro aqui e o propaga de forma controlada
        error("Erro em handleFullProfileUpdate (IA):", err.message);
        return { success: false, error: err.message };
    }
};