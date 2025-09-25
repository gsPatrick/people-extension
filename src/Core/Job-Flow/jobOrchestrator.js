import { getAllJobs, getJobTags } from '../../Inhire/Jobs/jobs.service.js';
import { addTalentToJob, removeApplication } from '../../Inhire/JobTalents/jobTalents.service.js';
import { log, error } from '../../utils/logger.service.js';

/**
 * Busca todas as vagas e as enriquece com suas tags.
 * @returns {Promise<{success: boolean, jobs?: Array<object>, error?: string}>}
 */

export const fetchPaginatedJobs = async (page = 1, limit = 10) => {
    log(`--- ORQUESTRADOR: Buscando vagas paginadas (Página: ${page}, Limite: ${limit}) ---`);
    const CACHE_KEY = 'all_jobs_with_details';

    try {
        // 1. Tenta buscar do cache primeiro
        let allJobs = getFromCache(CACHE_KEY);

        // 2. Se não estiver no cache, busca da API e armazena
        if (!allJobs) {
            log("CACHE MISS: Vagas não encontradas no cache. Buscando da API da InHire...");
            const jobsResult = await fetchAllJobsWithDetails(); // Reutiliza sua função existente
            if (!jobsResult.success) {
                throw new Error(jobsResult.error || "Falha ao buscar vagas da InHire.");
            }
            allJobs = jobsResult.jobs;
            setToCache(CACHE_KEY, allJobs); // Salva a lista completa no cache
        } else {
            log("CACHE HIT: Vagas encontradas no cache.");
        }

        // 3. Realiza a paginação na lista completa (do cache ou recém-buscada)
        const totalJobs = allJobs.length;
        const totalPages = Math.ceil(totalJobs / limit);
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const paginatedJobs = allJobs.slice(startIndex, endIndex);

        return {
            success: true,
            data: {
                jobs: paginatedJobs,
                currentPage: page,
                totalPages: totalPages,
                totalJobs: totalJobs
            }
        };

    } catch (err) {
        error("Erro em fetchPaginatedJobs:", err.message);
        return { success: false, error: err.message };
    }
};


export const fetchAllJobsWithDetails = async () => {
    log("--- ORQUESTRADOR: Buscando e enriquecendo todas as vagas ---");
    try {
        const allJobs = await getAllJobs();
        if (!allJobs) {
            throw new Error("Não foi possível buscar a lista de vagas.");
        }

        // Enriquecer cada vaga com suas tags
        const enrichedJobs = await Promise.all(
            allJobs.map(async (job) => {
                const tags = await getJobTags(job.id);
                return {
                    ...job,
                    tags: tags || [] // Garante que a propriedade tags sempre exista
                };
            })
        );
        
        return { success: true, jobs: enrichedJobs };
    } catch (err) {
        error("Erro em fetchAllJobsWithDetails:", err.message);
        return { success: false, error: err.message };
    }
};

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