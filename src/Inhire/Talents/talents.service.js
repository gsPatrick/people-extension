// src/Inhire/Talents/talents.service.js

import apiClient from '../inhireCore.js';
const API_BASE_URL = 'https://api.inhire.app';
import { log, error } from '../../utils/logger.service.js'; 




export const createTalent = async (talentData) => {
  log("Criando novo talento com os dados:", talentData); // MUDADO para log
  if (!talentData.linkedinUsername) {
      error("O nome de usuário do LinkedIn (linkedinUsername) é obrigatório para criar um talento.");
      return null;
  }
  try {
    const response = await apiClient.post(`${API_BASE_URL}/talents`, talentData);
    log("Talento criado com sucesso:", response.data);
    return response.data;
  } catch (err) {
    error("Erro ao criar talento:", err.response?.data?.message || err.message);
    return null;
  }
};

export const updateTalent = async (talentId, updateData) => {
  log(`Atualizando talento ${talentId} com os dados:`, updateData); // MUDADO para log
  try {
    await apiClient.patch(`${API_BASE_URL}/talents/${talentId}`, updateData);
    log("Talento atualizado com sucesso.");
    return true;
  } catch (err) {
    error("Erro ao atualizar talento:", err.response?.data?.message || err.message);
    return false;
  }
};

export const deleteTalent = async (talentId) => {
  log(`Removendo talento ${talentId}`); // MUDADO para log
  try {
    await apiClient.delete(`${API_BASE_URL}/talents/${talentId}`);
    log("Talento removido com sucesso.");
    return true;
  } catch (err) {
    error("Erro ao remover talento:", err.response?.data?.message || err.message);
    return false;
  }
}

export const getAllTalentsPaginated = async (limit = 20, exclusiveStartKey = null) => {
  log(`Buscando uma página de talentos (limite de ${limit}).`); // Mensagem simplificada
  try {
    const requestBody = {}; 
    if (exclusiveStartKey) {
      requestBody.exclusiveStartKey = exclusiveStartKey;
    }
    const response = await apiClient.post(`${API_BASE_URL}/talents/paginated`, requestBody);
    return response.data;
  } catch(err) {
      error("Erro ao buscar página de talentos:", err.response?.data?.message || err.message);
      return null;
  }
};

export const getTalentById = async (talentId) => {
  log(`--- SERVIÇO: Buscando detalhes do talento ID: ${talentId} ---`);
  try {
    const response = await apiClient.get(`${API_BASE_URL}/talents/${talentId}`);
    return response.data;
  } catch (err) {
    error(`Erro ao buscar talento ${talentId} na InHire:`, err.response?.data?.message || err.message);
    return null;
  }
};

// ==========================================================
// FUNÇÃO MOVIDA PARA CÁ
// ==========================================================
/**
 * Busca todas as candidaturas (JobTalent) de um talento específico.
 * Endpoint: GET /job-talents/talents/:talentId
 * @param {string} talentId - O ID do talento.
 * @returns {Promise<Array<object>|null>} A lista de candidaturas.
 */
export const getApplicationsForTalent = async (talentId) => {
    log(`--- SERVIÇO (talents.service): Buscando candidaturas para o talento ${talentId} ---`);
    try {
        // A implementação original já usava o apiClient, o que é correto.
        // O erro "Invalid key=value pair" sugere um problema no endpoint da API
        // que não está processando o cabeçalho 'Authorization: Bearer <token>' corretamente.
        // A chamada está sintaticamente correta do nosso lado.
        const response = await apiClient.get(`${API_BASE_URL}/job-talents/talents/${talentId}`);
        return response.data.items || [];
    } catch (err) {
        // O erro de autorização vai cair aqui.
        error(`Erro ao buscar candidaturas para o talento ${talentId}:`, err.response?.data?.message || err.message);
        return null; 
    }
};

/**
 * Busca talentos com base em filtros.
 * Esta implementação busca talentos paginados e filtra em memória.
 * ATENÇÃO: Para grandes volumes de dados, o ideal é que a API da InHire forneça um endpoint de busca direta.
 * @param {object} filters - Objeto de filtros (ex: { linkedinUsername: 'usuario' }).
 * @returns {Promise<object|null>} O primeiro talento encontrado ou null.
 */
export const findTalent = async (filters) => {
  log(`--- SERVIÇO: Buscando talento com filtros: ${JSON.stringify(filters)} ---`);
  try {
    let allTalents = [];
    let hasMorePages = true;
    let exclusiveStartKey = null;
    const limitPerPage = 50; // Busca em lotes de 50

    // Itera sobre as páginas até encontrar o talento ou esgotar
    while (hasMorePages) {
      const response = await getAllTalentsPaginated(limitPerPage, exclusiveStartKey);
      if (!response || !response.items) {
        throw new Error("Falha ao buscar talentos paginados para filtro.");
      }

      allTalents.push(...response.items);

      // Filtra a página atual em busca do linkedinUsername
      const foundInPage = response.items.find(t => {
        // Normaliza o slug antes de comparar, removendo barras finais se houver
        const normalizedFilterUsername = filters.linkedinUsername ? filters.linkedinUsername.toLowerCase().replace(/\/+$/, '') : null;
        const normalizedTalentUsername = t.linkedinUsername ? t.linkedinUsername.toLowerCase().replace(/\/+$/, '') : null;
        
        return normalizedFilterUsername && normalizedTalentUsername === normalizedFilterUsername;
      });

      if (foundInPage) {
        log(`Talento encontrado via findTalent: ${foundInPage.name}`);
        return foundInPage; // Retorna o talento assim que encontrado
      }

      if (response.exclusiveStartKey) {
        exclusiveStartKey = response.exclusiveStartKey;
      } else {
        hasMorePages = false; // Não há mais páginas
      }
    }

    log("Nenhum talento encontrado com os filtros fornecidos após varrer todas as páginas.");
    return null; // Não encontrou após todas as páginas
  } catch (err) {
    error(`Erro ao buscar talento com filtros ${JSON.stringify(filters)}:`, err.response?.data?.message || err.message);
    return null; // Retorna null em caso de erro na API
  }
};