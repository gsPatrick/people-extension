// src/Server/apiRoutes.js

import { Router } from 'express';

// Importando os orquestradores com os nomes corretos
import { validateProfile, handleConfirmCreation, handleEditTalent, handleDeleteTalent } from '../Core/Candidate-Flow/candidateOrchestrator.js';
import { fetchAllJobsWithDetails, handleJobSelection, handleRemoveApplication } from '../Core/Job-Flow/jobOrchestrator.js';
import { 
    fetchAllTalents, 
    fetchCandidatesForJob, 
    handleUpdateApplicationStatus, 
    fetchTalentDetails, 
    fetchCustomFields,
    fetchCandidateDetailsForJobContext 
} from '../Core/management-flow/managementOrchestrator.js';
import { fetchScorecardDataForApplication, handleScorecardSubmission, handleCreateScorecardAndKit,fetchInterviewKitDetails } from '../Core/Evaluation-Flow/evaluationOrchestrator.js';
const router = Router();

// ===================================
// ROTAS DE VAGAS E CANDIDATURAS
// ===================================

router.get('/jobs', async (req, res) => {
    const result = await fetchAllJobsWithDetails();
    // Esta rota retorna um array diretamente, o que é esperado pelo frontend para esta view.
    if (result.success) res.status(200).json(result.jobs);
    else res.status(500).json({ error: result.error });
});

router.post('/apply', async (req, res) => {
    const { jobId, talentId } = req.body;
    if (!jobId || !talentId) return res.status(400).json({ error: 'Os campos "jobId" e "talentId" são obrigatórios.' });
    const result = await handleJobSelection(jobId, talentId);
    // Retorna o objeto da aplicação diretamente.
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
  // Retorna a estrutura completa { success, exists, talent, profileData }
  if (result.success) res.status(200).json(result);
  else res.status(500).json({ error: result.error });
});

router.post('/create-talent', async (req, res) => {
  const talentData = req.body;
  const result = await handleConfirmCreation(talentData);
  // Retorna o objeto do talento diretamente.
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
    // Retorna a estrutura completa { success, data: { talents, nextPageKey } }
    if (result.success) res.status(200).json(result);
    else res.status(500).json({ error: result.error });
});

router.get('/talents/:id', async (req, res) => {
    const { id } = req.params;
    const result = await fetchTalentDetails(id);
    // Retorna a estrutura completa { success, talent }
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
    // Retorna a estrutura completa { success, data: { candidates, stages } }
    if (result.success) res.status(200).json(result);
    else res.status(500).json({ error: result.error });
});

router.get('/candidate-details/job/:jobId/talent/:talentId', async (req, res) => {
    const { jobId, talentId } = req.params;
    const result = await fetchCandidateDetailsForJobContext(jobId, talentId);
    // Retorna a estrutura completa { success, candidateData }
    if (result.success) res.status(200).json(result);
    else res.status(500).json({ error: result.error });
});

router.patch('/applications/:applicationId/status', async (req, res) => {
    const { applicationId } = req.params;
    const { stageId } = req.body;
    if (!stageId) return res.status(400).json({ error: 'O campo "stageId" é obrigatório.' });
    const result = await handleUpdateApplicationStatus(applicationId, stageId);
    // Retorna o objeto da aplicação atualizada diretamente.
    if (result.success) res.status(200).json(result.application);
    else res.status(500).json({ error: result.error });
});


// ===================================
// ROTAS DE SCORECARD
// ===================================

router.get('/scorecard-data/application/:applicationId/job/:jobId', async (req, res) => {
    const { applicationId, jobId } = req.params;
    const result = await fetchScorecardDataForApplication(applicationId, jobId);
    // Retorna a estrutura completa { success, data: { type, content } }
    if (result.success) res.status(200).json(result);
    else res.status(500).json({ error: result.error });
});

router.post('/submit-scorecard', async (req, res) => {
    const { applicationId, scorecardId, evaluationData } = req.body;
    if (!applicationId || !scorecardId || !evaluationData) {
        return res.status(400).json({ error: 'Os campos "applicationId", "scorecardId" e "evaluationData" são obrigatórios.' });
    }
    const result = await handleScorecardSubmission(applicationId, scorecardId, evaluationData);
    if (result.success) res.status(200).json(result.submission);
    else res.status(500).json({ error: result.error });
});

router.post('/create-scorecard-and-kit', async (req, res) => {
    const result = await handleCreateScorecardAndKit(req.body);
    if (result.success) res.status(201).json(result.kit);
    else res.status(500).json({ error: result.error });
});



// ===================================
// ROTAS DE GERENCIAMENTO (CAMPOS PERSONALIZADOS)
// ===================================

router.get('/custom-fields/:entity', async (req, res) => {
    const { entity } = req.params;
    if (!['TALENTS', 'JOB_TALENTS'].includes(entity.toUpperCase())) {
        return res.status(400).json({ error: 'Entidade inválida. Use "TALENTS" ou "JOB_TALENTS".' });
    }
    const result = await fetchCustomFields(entity.toUpperCase());
    // Retorna o array de campos diretamente.
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