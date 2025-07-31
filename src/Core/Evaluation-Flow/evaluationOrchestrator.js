// src/Core/Evaluation-Flow/evaluationOrchestrator.js

import { getInterviewKitsForJob, submitScorecardResponse, getScorecardSummaryForApplication, createJobScorecard, createInterviewKit, getInterviewKitById } from '../../Inhire/ScoreCards/scorecards.service.js';
import { log, error } from '../../utils/logger.service.js';
import { saveDebugDataToFile } from '../../utils/debug.service.js';

// ==========================================================
// NOVA FUNÇÃO HELPER PARA TRANSFORMAR OS DADOS
// ==========================================================
/**
 * Transforma a resposta complexa do resumo de scorecard da InHire em uma estrutura
 * organizada e fácil de renderizar pelo frontend.
 * @param {Array<object>} apiSummary - A resposta crua da API.
 * @returns {Array<object>} Um array de avaliações formatadas.
 */
const mapScorecardSummary = (apiSummary) => {
    if (!apiSummary || apiSummary.length === 0) {
        return [];
    }

    const formattedEvaluations = [];

    apiSummary.forEach(evaluationGroup => {
        evaluationGroup.evaluationsFeedbacks.forEach(feedback => {
            
            // ==========================================================
            // CORREÇÃO APLICADA AQUI
            // ==========================================================
            const formattedEval = {
                userId: evaluationGroup.userId,
                userName: evaluationGroup.userName,
                // Adiciona o ID do kit de entrevista ao objeto formatado
                scorecardInterviewId: feedback.scorecardInterviewId,
                interviewName: feedback.scorecardInterviewName,
                feedback: {
                    comment: feedback.comment,
                    proceed: feedback.proceed
                },
                privateNotes: feedback.annotations,
                skillCategories: []
            };

            // ... (resto da lógica de mapeamento de categorias e skills permanece a mesma) ...
            
            const categoriesMap = new Map();
            let skillCounter = 0;

            evaluationGroup.skillsScore.forEach(item => {
                if (item.name) {
                    const category = {
                        name: item.name,
                        skills: item.skills.map(skill => ({
                            name: skill.name,
                            description: skill.description || '',
                            score: 0
                        }))
                    };
                    categoriesMap.set(item.name, category);
                    formattedEval.skillCategories.push(category);
                }
            });

            evaluationGroup.skillsScore.forEach(item => {
                if (!item.name && Array.isArray(item.skills)) {
                    item.skills.forEach(scoreItem => {
                        for (const category of formattedEval.skillCategories) {
                            for (const skill of category.skills) {
                                if (skill.score === 0 && skillCounter < (evaluationGroup.skillsScore.flatMap(s => s.skills).filter(sk => sk.score !== undefined).length)) {
                                    skill.score = scoreItem.score;
                                    skillCounter++;
                                    return;
                                }
                            }
                        }
                    });
                }
            });
            
            formattedEvaluations.push(formattedEval);
        });
    });

    return formattedEvaluations;
};


export const fetchScorecardDataForApplication = async (applicationId, jobId) => {
    log(`--- ORQUESTRADOR: Buscando dados de scorecard para candidatura ${applicationId} ---`);
    try {
        const summary = await getScorecardSummaryForApplication(applicationId);
        
        saveDebugDataToFile(`scorecard_summary_raw_${applicationId}.txt`, summary);

        if (summary && summary.length > 0) {
            // Se já existe um resumo (respostas), TRANSFORMA os dados antes de retornar.
            const formattedSummary = mapScorecardSummary(summary);
            saveDebugDataToFile(`scorecard_summary_formatted_${applicationId}.txt`, formattedSummary);
            return { success: true, data: { type: 'summary', content: formattedSummary } };
        } else {
            // Se não, busca os kits de entrevista disponíveis para a vaga.
            const interviewKits = await getInterviewKitsForJob(jobId);
            saveDebugDataToFile(`interview_kits_for_job_${jobId}.txt`, interviewKits);
            return { success: true, data: { type: 'kits', content: interviewKits } };
        }
    } catch (err) {
        error("Erro em fetchScorecardDataForApplication:", err.message);
        return { success: false, error: err.message };
    }
};

export const handleScorecardSubmission = async (applicationId, scorecardId, evaluationDataFromFrontend) => {
  log(`--- ORQUESTRADOR: Submetendo avaliação para a candidatura ${applicationId} ---`);
  try {
    if (!applicationId || !scorecardId || !evaluationDataFromFrontend) {
        throw new Error("applicationId, scorecardId e evaluationData são obrigatórios.");
    }

    // O frontend envia `evaluationData` com um objeto `ratings` achatado.
    // Precisamos buscar a estrutura do kit para reconstruir o payload que a API da InHire espera.
    const kitStructure = await getInterviewKitById(scorecardId);
    if (!kitStructure) {
        throw new Error("Não foi possível encontrar a estrutura do kit para formatar o payload.");
    }

    // Transforma o payload do frontend para o formato da API da InHire
    const payloadForInHire = {
        feedback: {
            comment: evaluationDataFromFrontend.feedback || '',
            proceed: evaluationDataFromFrontend.decision || 'NO_DECISION'
        },
        privateNotes: evaluationDataFromFrontend.notes || '',
        skillCategories: kitStructure.skillCategories.map(category => ({
            name: category.name, // Nome da categoria
            skills: category.skills.map(skill => ({
                name: skill.name, // Nome da skill
                score: evaluationDataFromFrontend.ratings[skill.id] || 0 // Pega a nota do objeto `ratings`
            }))
        }))
    };

    saveDebugDataToFile(
        `submission_payload_${applicationId}_${Date.now()}.txt`,
        {
            fromFrontend: evaluationDataFromFrontend,
            sentToInHire: payloadForInHire
        }
    );

    const submissionResult = await submitScorecardResponse(applicationId, scorecardId, payloadForInHire);
    
    if (!submissionResult) {
      throw new Error("Falha ao submeter avaliação. A API da InHire não retornou sucesso.");
    }

    return { success: true, submission: submissionResult };
  } catch (err) {
    error("Erro em handleScorecardSubmission:", err.message);
    return { success: false, error: err.message };
  }
};

export const handleCreateScorecardAndKit = async (data) => {
    const { jobId, jobStageId, name, script, skillCategories } = data;
    log(`--- ORQUESTRADOR: Criando Scorecard e Kit para vaga ${jobId} ---`);
    try {
        if (!jobId || !jobStageId || !name || !skillCategories) {
            throw new Error("Dados insuficientes para criar Scorecard e Kit.");
        }
        
        await createJobScorecard(jobId, skillCategories);
        log(`Scorecard base para a vaga ${jobId} garantido.`);

        const newKit = await createInterviewKit({ jobId, jobStageId, name, script, skillCategories });
        if (!newKit) throw new Error("Falha ao criar o novo Kit de Entrevista.");

        log(`Kit de Entrevista "${name}" criado com sucesso.`);
        return { success: true, kit: newKit };

    } catch (err) {
        error("Erro em handleCreateScorecardAndKit:", err.message);
        return { success: false, error: err.message };
    }
};


/**
 * Busca os detalhes de um kit de entrevista específico.
 * @param {string} kitId - O ID do kit de entrevista.
 * @returns {Promise<{success: boolean, kit?: object, error?: string}>}
 */
export const fetchInterviewKitDetails = async (kitId) => {
    log(`--- ORQUESTRADOR: Buscando detalhes para o kit de entrevista ${kitId} ---`);
    try {
        const kit = await getInterviewKitById(kitId);
        if (!kit) throw new Error("Kit de entrevista não encontrado.");
        return { success: true, kit: kit };
    } catch (err) {
        error("Erro em fetchInterviewKitDetails:", err.message);
        return { success: false, error: err.message };
    }
};