import { getAllJobs, getJobTags } from '../../Inhire/Jobs/jobs.service.js';
import { addTalentToJob, removeApplication } from '../../Inhire/JobTalents/jobTalents.service.js';
import { log, error } from '../../utils/logger.service.js';
import { getFromCache, setToCache } from '../../utils/cache.service.js';
import { saveDebugDataToFile } from '../../utils/debug.service.js';

const JOBS_CACHE_KEY = 'all_jobs_with_details';

// ==========================================================
// FUNÇÃO SIMPLIFICADA: AGORA APENAS LÊ DO CACHE
// ==========================================================
export const fetchPaginatedJobs = async (page = 1, limit = 10, status = 'open') => {
    log(`--- ORQUESTRADOR: Servindo vagas paginadas do cache (Página: ${page}, Status: ${status}) ---`);
    
    try {
        const allJobs = getFromCache(JOBS_CACHE_KEY);

        // Se o cache estiver vazio (ex: servidor acabou de iniciar), retorna uma resposta vazia.
        // O processo de sync em segundo plano irá preenchê-lo em breve.
        if (!allJobs) {
            log("AVISO: Cache de vagas ainda está vazio. Retornando lista vazia.");
            return {
                success: true,
                data: { jobs: [], currentPage: 1, totalPages: 0, totalJobs: 0 }
            };
        }

        const filteredJobs = allJobs.filter(job => job.status === status);

        const totalJobsInFilter = filteredJobs.length;
        const totalPages = Math.ceil(totalJobsInFilter / limit);
        const startIndex = (page - 1) * limit;
        const paginatedJobs = filteredJobs.slice(startIndex, startIndex + limit);

        return {
            success: true,
            data: {
                jobs: paginatedJobs,
                currentPage: page,
                totalPages: totalPages,
                totalJobs: totalJobsInFilter
            }
        };

    } catch (err) {
        error("Erro em fetchPaginatedJobs:", err.message);
        return { success: false, error: err.message };
    }
};

// Esta função continua sendo usada pelo processo de sync em segundo plano
export const fetchAllJobsWithDetails = async () => {
    log("--- ORQUESTRADOR (SYNC): Buscando e enriquecendo todas as vagas ---");
    try {
        const allJobs = await getAllJobs();
        if (!allJobs) {
            throw new Error("Não foi possível buscar a lista de vagas.");
        }
        
        saveDebugDataToFile(`all_jobs_raw_${Date.now()}.txt`, allJobs);

        const enrichedJobs = await Promise.all(
            allJobs.map(async (job) => {
                const tags = await getJobTags(job.id);
                return {
                    ...job,
                    tags: tags || []
                };
            })
        );
        
        return { success: true, jobs: enrichedJobs };
    } catch (err) {
        error("Erro em fetchAllJobsWithDetails:", err.message);
        return { success: false, error: err.message };
    }
};

// O resto das funções permanece igual
export const handleJobSelection = async (jobId, talentId) => {
  log(`--- ORQUESTRADOR: Aplicando talento ${talentId} à vaga ${jobId} ---`);
  try {
    if (!jobId || !talentId) throw new Error("jobId e talentId são obrigatórios.");
    const application = await addTalentToJob(jobId, talentId);
    if (!application) throw new Error("Falha ao adicionar talento à vaga.");
    return { success: true, application };
  } catch (err) {
    error("Erro em handleJobSelection:", err.message);
    return { success: false, error: err.message };
  }
};

export const handleRemoveApplication = async (applicationId) => {
  log(`--- ORQUESTRADOR: Removendo candidatura ${applicationId} ---`);
  try {
      const success = await removeApplication(applicationId);
      if (!success) {
        throw new Error("A API da InHire falhou ao remover a candidatura.");
      }
      return { success: true };
  } catch(err) {
      error("Erro em handleRemoveApplication:", err.message);
      return { success: false, error: err.message };
  }
};