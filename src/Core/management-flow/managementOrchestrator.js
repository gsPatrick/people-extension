// src/Core/management-flow/managementOrchestrator.js

import { getAllTalentsPaginated, getTalentById } from '../../Inhire/Talents/talents.service.js';
import { getApplicationsForJob, updateApplication, getJobTalent } from '../../Inhire/JobTalents/jobTalents.service.js';
import { getJobDetails } from '../../Inhire/Jobs/jobs.service.js';
import { log, error } from '../../utils/logger.service.js';
import { saveDebugDataToFile } from '../../utils/debug.service.js';
import { getCustomFieldsForEntity } from '../../Inhire/CustomDataManager/customDataManager.service.js';
import { getFromCache, setToCache } from '../../utils/cache.service.js';

export const fetchCandidatesForJob = async (jobId) => {
    const CACHE_KEY = `candidates_for_job_${jobId}`;
    log(`--- ORQUESTRADOR: Buscando candidaturas para a vaga ${jobId} ---`);

    const cachedData = getFromCache(CACHE_KEY);
    if (cachedData) {
        log(`CACHE HIT: Retornando candidaturas para a vaga ${jobId} do cache.`);
        return { success: true, data: cachedData };
    }

    log(`CACHE MISS: Buscando candidaturas para a vaga ${jobId} da API.`);
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

        const dataToCache = { candidates: formattedCandidates, stages: availableStages };
        setToCache(CACHE_KEY, dataToCache);
        
        return { success: true, data: dataToCache };

    } catch (err) {
        error("Erro em fetchCandidatesForJob:", err.message);
        return { success: false, error: err.message };
    }
};

export const handleUpdateApplicationStatus = async (applicationId, newStageId) => {
    log(`--- ORQUESTRADOR: Atualizando etapa da candidatura ${applicationId} para o ID: ${newStageId} ---`);
    try {
        const payload = { stageId: newStageId };
        const updatedApplication = await updateApplication(applicationId, payload);
        if (!updatedApplication) throw new Error("Falha ao atualizar a candidatura.");

        const jobId = updatedApplication.jobId;
        if (jobId) {
            const CACHE_KEY = `candidates_for_job_${jobId}`;
            const cachedData = getFromCache(CACHE_KEY);

            if (cachedData) {
                const candidateIndex = cachedData.candidates.findIndex(c => c.application.id === applicationId);
                if (candidateIndex !== -1) {
                    const newStage = cachedData.stages.find(s => s.id === newStageId);
                    
                    cachedData.candidates[candidateIndex].application.stageId = newStageId;
                    cachedData.candidates[candidateIndex].application.stageName = newStage?.name || 'Etapa Desconhecida';
                    
                    setToCache(CACHE_KEY, cachedData);
                    log(`CACHE UPDATE: Status da candidatura ${applicationId} atualizado no cache da vaga ${jobId}.`);
                }
            }
        }
        
        return { success: true, application: updatedApplication };
    } catch (err) {
        error("Erro em handleUpdateApplicationStatus:", err.message);
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

export const fetchCandidateDetailsForJobContext = async (jobId, talentId) => {
    log(`--- ORQUESTRADOR: Buscando detalhes contextuais para T:${talentId} em V:${jobId} ---`);
    try {
        const [talentProfile, applicationDetails, customFieldDefinitions] = await Promise.all([
            getTalentById(talentId),
            getJobTalent(jobId, talentId),
            getCustomFieldsForEntity('JOB_TALENTS')
        ]);

        if (!talentProfile) throw new Error(`Perfil do talento ${talentId} não encontrado.`);
        if (!applicationDetails) throw new Error(`Candidatura para talento ${talentId} na vaga ${jobId} não encontrada.`);

        const savedValuesMap = new Map(
            (applicationDetails.customFields || []).map(field => [field.id, field.value])
        );

        const enrichedCustomFields = (customFieldDefinitions || []).map(definition => {
            const answerOptions = definition.options || [];
            
            return {
                ...definition,
                answerOptions,
                value: savedValuesMap.get(definition.id) || null
            };
        });
        
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
// FUNÇÃO QUE ESTAVA FALTANDO
// ==========================================================
export const fetchAllTalentsForSync = async () => {
    log("--- ORQUESTRADOR (SYNC): Buscando TODOS os talentos com paginação interna ---");
    try {
        let allTalents = [];
        let hasMorePages = true;
        let exclusiveStartKey = null;

        while(hasMorePages) {
            const response = await getAllTalentsPaginated(100, exclusiveStartKey);
            if (!response || !response.items) {
                throw new Error("A API falhou ao buscar uma página de talentos.");
            }
            
            allTalents.push(...response.items);

            if (response.exclusiveStartKey) {
                exclusiveStartKey = response.exclusiveStartKey;
            } else {
                hasMorePages = false;
            }
        }
        log(`--- ORQUESTRADOR (SYNC): Busca completa. Total de ${allTalents.length} talentos carregados.`);
        return { success: true, talents: allTalents };
    } catch (err) {
        error("Erro em fetchAllTalentsForSync:", err.message);
        return { success: false, error: err.message };
    }
};

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