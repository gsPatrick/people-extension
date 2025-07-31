import apiClient from '../inhireCore.js';
import { log, error } from '../../utils/logger.service.js';

const API_BASE_URL = 'https://api.inhire.app';

/**
 * Busca TODAS as vagas da API, iterando sobre a paginação internamente.
 * @returns {Promise<Array<object>|null>} Uma lista completa de todas as vagas.
 */
export const getAllJobs = async () => {
  log(`--- SERVIÇO: Buscando TODAS as vagas com paginação interna ---`);
  let allJobs = [];
  let hasMorePages = true;
  let exclusiveStartKey = null;

  try {
    while (hasMorePages) {
      const payload = { limit: 100 }; // Pega lotes grandes
      if (exclusiveStartKey) {
        payload.exclusiveStartKey = exclusiveStartKey;
      }
      
      const response = await apiClient.post(`${API_BASE_URL}/jobs/paginated/lean`, payload);
      const pageItems = response.data.results;
      
      if (pageItems?.length > 0) {
        allJobs.push(...pageItems);
      }

      if (response.data.exclusiveStartKey) {
        exclusiveStartKey = response.data.exclusiveStartKey;
      } else {
        hasMorePages = false;
      }
    }
    log(`Busca completa. Total de ${allJobs.length} vagas carregadas.`);
    return allJobs;
  } catch (err) {
    error("Erro ao buscar todas as vagas:", err.response?.data || err.message);
    return null;
  }
};

/**
 * Busca as tags de uma vaga específica.
 * @param {string} jobId - O ID da vaga.
 * @returns {Promise<Array<object>|null>} Uma lista de tags.
 */
export const getJobTags = async (jobId) => {
    log(`--- SERVIÇO: Buscando tags para a vaga ${jobId} ---`);
    try {
        const response = await apiClient.get(`${API_BASE_URL}/jobs/${jobId}/tags`);
        return response.data || [];
    } catch (err) {
        error(`Erro ao buscar tags da vaga ${jobId}:`, err.response?.data || err.message);
        return null;
    }
};

/**
 * Obtém os detalhes de uma vaga específica.
 * @param {string} jobId - O ID da vaga.
 * @returns {Promise<object | null>} Os detalhes da vaga.
 */
export const getJobDetails = async (jobId) => {
    log(`Buscando detalhes da vaga ID: ${jobId}`);
    try {
        const response = await apiClient.get(`${API_BASE_URL}/jobs/${jobId}`);
        return response.data;
    } catch (error) {
        log(`Erro ao buscar detalhes da vaga ${jobId}:`, error.response?.data || error.message);
        return null;
    }
}