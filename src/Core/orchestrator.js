// Importando os serviços "trabalhadores"
import { extractProfileData } from '../Linkedin/profile.service.js';
import { findTalent, createTalent } from '../Inhire/Talents/talents.service.js';
import { getJobsPaginated } from '../Inhire/Jobs/jobs.service.js';
import { addTalentToJob } from '../Inhire/JobTalents/jobTalents.service.js';
import { getInterviewKitsForJob, submitScorecardResponse } from '../Inhire/Scorecards/scorecards.service.js';

// Importando nosso novo gerenciador de sessão
import { updateSessionData, getSessionData, clearSession } from './session.service.js';

/**
 * AÇÃO 1: Inicia o fluxo quando o usuário está em uma página de perfil.
 * Limpa a sessão anterior, extrai dados do perfil e encontra/cria o talento na InHire.
 * Salva o ID do talento na sessão.
 * @returns {Promise<{success: boolean, talent?: object, error?: string}>}
 */
export const handleProfileLoad = async () => {
  console.log("--- ORQUESTRADOR: handleProfileLoad ---");
  try {
    await clearSession(); // Garante que estamos começando um fluxo limpo

    const profileData = await extractProfileData();
    if (!profileData) throw new Error("Não foi possível extrair dados do perfil do LinkedIn.");

    let talent = await findTalent({ linkedinUrl: profileData.profileUrl });

    if (!talent) {
      console.log("Talento não encontrado, criando novo...");
      talent = await createTalent({
        name: profileData.name,
        linkedinUsername: profileData.profileUrl.split('/in/')[1]?.replace('/', ''),
        // Adicionar outros campos relevantes do profileData aqui...
      });
      if (!talent) throw new Error("Falha ao criar o novo talento na InHire.");
    }

    await updateSessionData({ talentId: talent.id, profileData });
    return { success: true, talent };
  } catch (error) {
    console.error("Erro em handleProfileLoad:", error.message);
    return { success: false, error: error.message };
  }
};

/**
 * AÇÃO 2: Executa quando o usuário seleciona uma vaga na interface.
 * Usa o talentId da sessão para criar a candidatura (JobTalent).
 * Salva o ID da vaga e da candidatura na sessão.
 * @param {string} jobId - O ID da vaga selecionada pelo usuário.
 * @returns {Promise<{success: boolean, application?: object, error?: string}>}
 */
export const handleJobSelection = async (jobId) => {
  console.log("--- ORQUESTRADOR: handleJobSelection ---");
  try {
    const { talentId } = await getSessionData();
    if (!talentId) throw new Error("ID do talento não encontrado na sessão. Inicie o fluxo em um perfil.");
    
    const application = await addTalentToJob(jobId, talentId);
    if (!application) throw new Error("Falha ao adicionar talento à vaga.");

    await updateSessionData({ jobId: jobId, applicationId: application.id });
    return { success: true, application };
  } catch (error) {
    console.error("Erro em handleJobSelection:", error.message);
    return { success: false, error: error.message };
  }
};

/**
 * AÇÃO 3: Executa quando o usuário envia um formulário de scorecard.
 * Usa os IDs da sessão para submeter a avaliação.
 * @param {object} evaluationData - Os dados da avaliação preenchidos pelo usuário.
 * @returns {Promise<{success: boolean, submission?: object, error?: string}>}
 */
export const handleScorecardSubmission = async (evaluationData) => {
  console.log("--- ORQUESTRADOR: handleScorecardSubmission ---");
  try {
    const { jobId, applicationId } = await getSessionData();
    if (!jobId || !applicationId) throw new Error("IDs da vaga ou candidatura não encontrados na sessão.");

    const interviewKits = await getInterviewKitsForJob(jobId);
    if (!interviewKits || interviewKits.length === 0) throw new Error("Nenhum scorecard encontrado para esta vaga.");
    
    const scorecardId = interviewKits[0].id; // Usando o primeiro scorecard como padrão
    
    const submissionResult = await submitScorecardResponse(applicationId, scorecardId, evaluationData);
    if (!submissionResult) throw new Error("Falha ao submeter avaliação.");

    console.log("Avaliação submetida com sucesso. Limpando a sessão.");
    await clearSession(); // Opcional: limpa a sessão ao concluir o fluxo com sucesso

    return { success: true, submission: submissionResult };
  } catch (error) {
    console.error("Erro em handleScorecardSubmission:", error.message);
    return { success: false, error: error.message };
  }
};

/**
 * FUNÇÃO DE APOIO: Para a UI buscar as vagas disponíveis.
 * @returns {Promise<{success: boolean, jobs?: object[], error?: string}>}
 */
export const fetchOpenJobs = async () => {
    console.log("--- ORQUESTRADOR: fetchOpenJobs ---");
    try {
        const jobsResponse = await getJobsPaginated();
        if (!jobsResponse || !jobsResponse.results) throw new Error("Não foi possível buscar as vagas.");

        const openJobs = jobsResponse.results.filter(job => job.status === 'open');
        return { success: true, jobs: openJobs };
    } catch (error) {
        console.error("Erro em fetchOpenJobs:", error.message);
        return { success: false, error: error.message };
    }
}

/**
 * FUNÇÃO DE APOIO: Para a UI buscar a estrutura do scorecard para renderizar.
 * @returns {Promise<{success: boolean, scorecard?: object, error?: string}>}
 */
export const fetchScorecardStructure = async () => {
    console.log("--- ORQUESTRADOR: fetchScorecardStructure ---");
    try {
        const { jobId } = await getSessionData();
        if (!jobId) throw new Error("ID da vaga não encontrado na sessão.");

        const interviewKits = await getInterviewKitsForJob(jobId);
        if (!interviewKits || interviewKits.length === 0) {
            return { success: true, scorecard: null, message: "Nenhum scorecard para esta vaga." };
        }
        
        return { success: true, scorecard: interviewKits[0] };
    } catch (error) {
        console.error("Erro em fetchScorecardStructure:", error.message);
        return { success: false, error: error.message };
    }
}