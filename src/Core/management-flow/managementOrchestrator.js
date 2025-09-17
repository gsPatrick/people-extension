// src/Core/management-flow/managementOrchestrator.js

import { getAllTalentsPaginated, getTalentById } from '../../Inhire/Talents/talents.service.js';
import { getApplicationsForJob, updateApplication, getJobTalent } from '../../Inhire/JobTalents/jobTalents.service.js';
import { getJobDetails } from '../../Inhire/Jobs/jobs.service.js';
import { log, error } from '../../utils/logger.service.js';
import { saveDebugDataToFile } from '../../utils/debug.service.js';
import { getCustomFieldsForEntity } from '../../Inhire/CustomDataManager/customDataManager.service.js';

// ... (outras funções como fetchCandidatesForJob, fetchTalentDetails, etc. permanecem iguais) ...
export const fetchCandidatesForJob = async (jobId) => {
    log(`--- ORQUESTRADOR: Buscando candidaturas para a vaga ${jobId} ---`);
    try {
        const applications = await getApplicationsForJob(jobId);
        if (applications === null) throw new Error("Falha ao buscar candidaturas na API.");

        saveDebugDataToFile(`candidates_for_job_${jobId}_${Date.now()}.txt`, applications);

        const stageMap = new Map();
        applications.forEach(app => {
            if (app?.stage?.id && app?.stage?.name) {
                stageMap.set(app.stage.id, { id: app.stage.id, name: app.stage.name });
            }
        });
        const availableStages = Array.from(stageMap.values());

        const formattedCandidates = applications
            .filter(app => app?.talent?.id && app?.stage?.id)
            .map(app => ({
                id: app.talent.id,
                name: app.talent.name,
                headline: app.talent.headline || 'Sem título',
                photo: app.talent.photo || null,
                application: {
                    id: app.id,
                    stageName: app.stage.name,
                    stageId: app.stage.id,
                    status: app.status,
                    createdAt: app.createdAt
                }
            }));

        return { success: true, data: { candidates: formattedCandidates, stages: availableStages } };

    } catch (err) {
        error("Erro em fetchCandidatesForJob:", err.message);
        return { success: false, error: err.message };
    }
};

export const fetchTalentDetails = async (talentId) => {
    log(`--- ORQUESTRADOR: Buscando detalhes do perfil do talento ${talentId} ---`);
    try {
        const talentData = await getTalentById(talentId); 
        if (!talentData) {
            throw new Error(`Talento com ID ${talentId} não encontrado.`);
        }

        const applications = talentData.jobs || []; 
        
        const enrichedApplications = await Promise.all(
            applications.map(async (app) => {
                const jobDetails = await getJobDetails(app.id); 
                return {
                    id: app.id, 
                    jobId: app.id, 
                    jobName: jobDetails ? jobDetails.name : 'Vaga Desconhecida',
                    status: app.stage?.name || 'Status Desconhecido' 
                };
            })
        );
        
        talentData.appliedJobs = enrichedApplications; 
        delete talentData.jobs; 

        return { success: true, talent: talentData };
    } catch (err) {
        error("Erro em fetchTalentDetails:", err.message);
        return { success: false, error: err.message };
    }
};


// ==========================================================
// FUNÇÃO MODIFICADA
// ==========================================================
export const fetchCandidateDetailsForJobContext = async (jobId, talentId) => {
    log(`--- ORQUESTRADOR: Buscando detalhes contextuais para T:${talentId} em V:${jobId} ---`);
    try {
        // 1. Busca todos os dados necessários em paralelo
        const [talentProfile, applicationDetails, customFieldDefinitions] = await Promise.all([
            getTalentById(talentId),
            getJobTalent(jobId, talentId),
            getCustomFieldsForEntity('JOB_TALENTS') // <<< NOVA CHAMADA
        ]);

        if (!talentProfile) throw new Error(`Perfil do talento ${talentId} não encontrado.`);
        if (!applicationDetails) throw new Error(`Candidatura para talento ${talentId} na vaga ${jobId} não encontrada.`);

        // 2. Cria um mapa (dicionário) dos valores já salvos para fácil acesso
        const savedValuesMap = new Map(
            (applicationDetails.customFields || []).map(field => [field.id, field.value])
        );

        // 3. Enriquece as definições com os valores salvos
        const enrichedCustomFields = (customFieldDefinitions || []).map(definition => {
            // A API retorna as opções dentro do campo 'options'
            const answerOptions = definition.options || [];
            
            return {
                ...definition,
                answerOptions, // Garante que as opções estejam disponíveis para o front-end
                value: savedValuesMap.get(definition.id) || null // Adiciona o valor salvo ou null se não houver
            };
        });
        
        // 4. Monta o payload final com os campos enriquecidos
        const candidateData = {
            id: talentProfile.id,
            name: talentProfile.name,
            headline: talentProfile.headline,
            email: talentProfile.email,
            phone: talentProfile.phone,
            location: talentProfile.location,
            linkedinUsername: talentProfile.linkedinUsername,
            photo: talentProfile.photo || null,
            
            application: {
                id: applicationDetails.id,
                stageName: applicationDetails.stage?.name || 'Etapa não definida',
                stageId: applicationDetails.stage?.id || null,
                status: applicationDetails.status,
                createdAt: applicationDetails.createdAt,
                // <<< SUBSTITUI a lista antiga pela nova lista enriquecida >>>
                customFields: enrichedCustomFields 
            }
        };

        return { success: true, candidateData: candidateData };

    } catch (err) {
        error("Erro em fetchCandidateDetailsForJobContext:", err.message);
        return { success: false, error: err.message };
    }
};
// ==========================================================
// FIM DA FUNÇÃO MODIFICADA
// ==========================================================


export const fetchAllTalents = async (limit, exclusiveStartKey) => {
    log("--- ORQUESTRADOR: Buscando uma página de talentos ---");
    try {
        const response = await getAllTalentsPaginated(limit, exclusiveStartKey);
        if (!response) throw new Error("A API falhou ao buscar talentos.");
        return { 
            success: true, 
            data: {
                talents: response.items,
                exclusiveStartKey: response.exclusiveStartKey 
            }
        };
    } catch (err) {
        error("Erro em fetchAllTalents:", err.message);
        return { success: false, error: err.message };
    }
};

export const handleUpdateApplicationStatus = async (applicationId, newStageId) => {
    log(`--- ORQUESTRADOR: Atualizando etapa da candidatura ${applicationId} para o ID: ${newStageId} ---`);
    try {
        const payload = { stageId: newStageId };
        const updatedApplication = await updateApplication(applicationId, payload);
        if (!updatedApplication) throw new Error("Falha ao atualizar a candidatura.");
        return { success: true, application: updatedApplication };
    } catch (err) {
        error("Erro em handleUpdateApplicationStatus:", err.message);
        return { success: false, error: err.message };
    }
};

export const fetchCustomFields = async (entity) => {
    log(`--- ORQUESTRADOR: Buscando campos personalizados para a entidade ${entity} ---`);
    try {
        const fields = await getCustomFieldsForEntity(entity);
        if (fields === null) throw new Error("A API falhou ao buscar os campos personalizados.");
        return { success: true, fields: fields };
    } catch (err) {
        error("Erro em fetchCustomFields:", err.message);
        return { success: false, error: err.message };
    }
};

export const handleUpdateCustomFieldsForApplication = async (applicationId, customFieldsData) => {
    log(`--- ORQUESTRADOR: Atualizando campos personalizados para a candidatura ${applicationId} ---`);
    try {
        if (!applicationId || !Array.isArray(customFieldsData)) {
            throw new Error("ID da candidatura e customFieldsData (array) são obrigatórios.");
        }

        const payload = { customFields: customFieldsData };
        log("Payload de atualização de campos personalizados:", JSON.stringify(payload, null, 2));

        const updatedApplication = await updateApplication(applicationId, payload);
        
        if (!updatedApplication) {
            throw new Error("Falha ao atualizar os campos personalizados da candidatura.");
        }
        
        return { success: true, application: updatedApplication };

    } catch (err) {
        error("Erro em handleUpdateCustomFieldsForApplication:", err.message);
        return { success: false, error: err.message };
    }
};