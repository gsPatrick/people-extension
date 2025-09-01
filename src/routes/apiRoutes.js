// src/Server/apiRoutes.js

import { Router } from 'express';

import { validateProfile, handleConfirmCreation, handleEditTalent, handleDeleteTalent } from '../Core/Candidate-Flow/candidateOrchestrator.js';
import { fetchAllJobsWithDetails, handleJobSelection, handleRemoveApplication } from '../Core/Job-Flow/jobOrchestrator.js';
import { 
    fetchAllTalents, 
    fetchCandidatesForJob, 
    handleUpdateApplicationStatus, 
    fetchTalentDetails, 
    fetchCustomFields,
    fetchCandidateDetailsForJobContext,
    handleUpdateCustomFieldsForApplication
} from '../Core/management-flow/managementOrchestrator.js';
// ADICIONADO: Importar a nova função do orquestrador
import { 
    fetchScorecardDataForApplication, 
    handleScorecardSubmission, 
    handleCreateScorecardAndKit,
    fetchInterviewKitDetails,
    fetchAvailableKitsForJob // <<< NOVA IMPORTAÇÃO
} from '../Core/Evaluation-Flow/evaluationOrchestrator.js';

import { syncProfileFromLinkedIn, evaluateSkillFromCache, getAIEvaluationCacheStatus } from '../Core/AI-Flow/aiOrchestrator.js';

const router = Router();

// <<< NOVA ROTA PARA VERIFICAR O CACHE >>>
router.get('/ai/cache-status/:talentId', async (req, res) => {
    const { talentId } = req.params;
    try {
        const result = await getAIEvaluationCacheStatus(talentId);
        res.status(200).json(result);
    } catch (err) {
        res.status(500).json({ error: `Falha ao verificar status do cache: ${err.message}` });
    }
});

// <<< ATUALIZAR ROTA DE AVALIAÇÃO >>>
router.post('/ai/evaluate-skill', async (req, res) => {
    // Agora usa a função 'evaluateSkillFromCache'
    const { talentId, jobDetails, skillToEvaluate } = req.body;
    if (!talentId || !jobDetails || !skillToEvaluate) {
        return res.status(400).json({ error: 'Dados de talento, vaga e critério são obrigatórios.' });
    }
    try {
        const result = await evaluateSkillFromCache(talentId, jobDetails, skillToEvaluate);
        res.status(200).json(result);
    } catch (err) {
        res.status(500).json({ error: `Falha ao processar avaliação com IA: ${err.message}` });
    }
});

// <<< NOVA ROTA PARA SINCRONIZAR >>>
router.post('/ai/sync-profile', async (req, res) => {
    const { talentId } = req.body;
    if (!talentId) {
        return res.status(400).json({ error: 'ID do talento é obrigatório.' });
    }
    try {
        const result = await syncProfileFromLinkedIn(talentId);
        res.status(200).json(result);
    } catch (err) {
        res.status(500).json({ error: `Falha ao sincronizar perfil: ${err.message}` });
    }
});


// ===================================
// ROTAS DE VAGAS E CANDIDATURAS
// ===================================



router.get('/jobs', async (req, res) => {
    const result = await fetchAllJobsWithDetails();
    if (result.success) res.status(200).json(result.jobs);
    else res.status(500).json({ error: result.error });
});

router.post('/apply', async (req, res) => {
    const { jobId, talentId } = req.body;
    if (!jobId || !talentId) return res.status(400).json({ error: 'Os campos "jobId" e "talentId" são obrigatórios.' });
    const result = await handleJobSelection(jobId, talentId);
    if (result.success) res.status(201).json(result.application);
    else res.status(500).json({ error: result.error });
});

router.delete('/applications/:id', async (req, res) => {
    const { id } = req.params;
    const result = await handleRemoveApplication(id);
    if (result.success) res.status(200).json({ message: 'Candidatura removida com sucesso.' });
    else res.status(500).json({ error: result.error });
});

// ===================================
// ROTAS DE CANDIDATO E PERFIL
// ===================================

router.post('/validate-profile', async (req, res) => {
  const { profileUrl } = req.body;
  if (!profileUrl) return res.status(400).json({ error: 'O campo "profileUrl" é obrigatório.' });
  const result = await validateProfile(profileUrl);
  if (result.success) res.status(200).json(result);
  else res.status(500).json({ error: result.error });
});

router.post('/create-talent', async (req, res) => {
  const talentData = req.body;
  const result = await handleConfirmCreation(talentData, talentData.jobId);
  if (result.success) res.status(201).json(result.talent);
  else res.status(500).json({ error: result.error });
});

// ===================================
// ROTAS DE GERENCIAMENTO (TALENTOS)
// ===================================

router.get('/talents', async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
    let exclusiveStartKey = null;
    if (req.query.nextPageKey) {
        try { exclusiveStartKey = JSON.parse(req.query.nextPageKey); } 
        catch (e) { return res.status(400).json({ error: "Parâmetro 'nextPageKey' inválido." }); }
    }
    const result = await fetchAllTalents(limit, exclusiveStartKey);
    if (result.success) res.status(200).json(result);
    else res.status(500).json({ error: result.error });
});

router.get('/talents/:id', async (req, res) => {
    const { id } = req.params;
    const result = await fetchTalentDetails(id);
    if (result.success) res.status(200).json(result);
    else res.status(404).json({ error: result.error });
});

router.patch('/talents/:id', async (req, res) => {
    const { id } = req.params;
    const result = await handleEditTalent(id, req.body);
    if (result.success) res.status(200).json({ message: 'Talento atualizado com sucesso.' });
    else res.status(500).json({ error: result.error });
});

router.delete('/talents/:id', async (req, res) => {
    const { id } = req.params;
    const result = await handleDeleteTalent(id);
    if (result.success) res.status(200).json({ message: 'Talento deletado com sucesso.' });
    else res.status(500).json({ error: result.error });
});

// ===================================
// ROTAS DE GERENCIAMENTO (VAGAS E CANDIDATURAS)
// ===================================

router.get('/jobs/:jobId/candidates', async (req, res) => {
    const { jobId } = req.params;
    const result = await fetchCandidatesForJob(jobId);
    if (result.success) res.status(200).json(result);
    else res.status(500).json({ error: result.error });
});

router.get('/candidate-details/job/:jobId/talent/:talentId', async (req, res) => {
    const { jobId, talentId } = req.params;
    const result = await fetchCandidateDetailsForJobContext(jobId, talentId); 
    if (result.success) res.status(200).json(result);
    else res.status(500).json({ error: result.error });
});

router.patch('/applications/:applicationId/status', async (req, res) => {
    const { applicationId } = req.params;
    const { stageId } = req.body;
    if (!stageId) return res.status(400).json({ error: 'O campo "stageId" é obrigatório.' });
    const result = await handleUpdateApplicationStatus(applicationId, stageId);
    if (result.success) res.status(200).json(result.application);
    else res.status(500).json({ error: result.error });
});

router.patch('/applications/:applicationId/custom-fields', async (req, res) => {
    const { applicationId } = req.params;
    const { customFields } = req.body;
    
    if (!Array.isArray(customFields)) {
        return res.status(400).json({ error: 'O campo "customFields" deve ser um array.' });
    }
    const result = await handleUpdateCustomFieldsForApplication(applicationId, customFields);
    
    if (result.success) {
        res.status(200).json(result.application);
    } else {
        res.status(500).json({ error: result.error });
    }
});

// ===================================
// ROTAS DE SCORECARD
// ===================================

router.get('/scorecard-data/application/:applicationId/job/:jobId', async (req, res) => {
    const { applicationId, jobId } = req.params;
    const result = await fetchScorecardDataForApplication(applicationId, jobId);
    if (result.success) res.status(200).json(result);
    else res.status(500).json({ error: result.error });
});

// ==========================================================
// NOVA ROTA PARA BUSCAR KITS
// ==========================================================
router.get('/jobs/:jobId/interview-kits', async (req, res) => {
    const { jobId } = req.params;
    const result = await fetchAvailableKitsForJob(jobId);
    if (result.success) res.status(200).json(result.kits); // Retorna o array de kits diretamente
    else res.status(500).json({ error: result.error });
});

router.post('/submit-scorecard', async (req, res) => {
    const result = await handleScorecardSubmission(req.body.applicationId, req.body.scorecardId, req.body.evaluationData);
    if (result.success) res.status(200).json(result.submission);
    else res.status(500).json({ error: result.error });
});

router.post('/create-scorecard-and-kit', async (req, res) => {
    const result = await handleCreateScorecardAndKit(req.body);
    if (result.success) res.status(201).json(result);
    else res.status(500).json({ error: result.error });
});

// ===================================
// ROTAS DE GERENCIAMENTO (CAMPOS PERSONALIZADOS E KITS)
// ===================================

router.get('/custom-fields/:entity', async (req, res) => {
    const { entity } = req.params;
    if (!['TALENTS', 'JOB_TALENTS'].includes(entity.toUpperCase())) {
        return res.status(400).json({ error: 'Entidade inválida. Use "TALENTS" ou "JOB_TALENTS".' });
    }
    const result = await fetchCustomFields(entity.toUpperCase());
    if (result.success) res.status(200).json(result.fields);
    else res.status(500).json({ error: result.error });
});

router.get('/interview-kit/:kitId', async (req, res) => {
    const { kitId } = req.params;
    const result = await fetchInterviewKitDetails(kitId);
    if (result.success) res.status(200).json(result.kit);
    else res.status(404).json({ error: result.error });
});

export default router;