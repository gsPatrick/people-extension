// src/Core/Candidate-Flow/candidateOrchestrator.js

import { extractProfileData } from '../../Linkedin/profile.service.js';
import { findTalent, createTalent, updateTalent, deleteTalent } from '../../Inhire/Talents/talents.service.js';
import { clearCacheByPrefix } from '../../utils/cache.service.js';
import { log, error } from '../../utils/logger.service.js';

/**
 * ETAPA 1 DO FLUXO: Extrai dados do perfil e VALIDA se o talento já existe na InHire.
 */
export const validateProfile = async (profileUrl) => {
  log(`--- ORQUESTRADOR: Iniciando VALIDAÇÃO para: ${profileUrl} ---`);
  try {
    const profileData = await extractProfileData(profileUrl);
    if (!profileData) throw new Error("Não foi possível extrair dados do perfil via Phantombuster.");

    // A validação de talento existente deve usar um campo único e consistente
    // como linkedinUsername ou profileUrl. O name pode não ser único.
    const usernameToSearch = profileData.linkedinUsername; // Usar linkedinUsername para busca
    let talentInHire = null;
    if (usernameToSearch) {
      talentInHire = await findTalent({ linkedinUsername: usernameToSearch });
    } else {
      log("AVISO: linkedinUsername não disponível para busca de talento existente.");
    }
    

    if (talentInHire) {
      log(`Validação concluída: Talento "${profileData.name}" JÁ EXISTE na InHire.`);
      return { 
        success: true, 
        exists: true,
        talent: talentInHire,
        profileData: profileData
      };
    } else {
      log(`Validação concluída: Talento "${profileData.name}" NÃO EXISTE na InHire.`);
      return { 
        success: true, 
        exists: false,
        talent: null,
        profileData: profileData
      };
    }
  } catch (err) {
    error("Erro em validateProfile:", err.message);
    return { success: false, error: err.message };
  }
};

/**
 * ETAPA 2 DO FLUXO: Cria um novo talento na InHire após confirmação.
 */
export const handleConfirmCreation = async (talentData) => { // talentData aqui é o profileData completo do frontend
    log(`--- ORQUESTRADOR: Confirmando CRIAÇÃO para: ${talentData.name} ---`);
    try {
        if (!talentData.name || !talentData.linkedinUsername) {
            throw new Error("Dados insuficientes para criar o talento. 'name' e 'linkedinUsername' são obrigatórios.");
        }
        
        const talentPayload = {
            name: talentData.name,
            linkedinUsername: talentData.linkedinUsername,
        };

        // Adicionar campos opcionais APENAS se eles tiverem um valor que não seja null, undefined ou string vazia
        // A API InHire parece ser rigorosa com 'null' para campos 'string'.
        if (talentData.headline) {
            talentPayload.headline = talentData.headline;
        }
        // Os campos 'email' e 'phone' não estão sendo populados pelo extractProfileData atualmente.
        // Se eles forem adicionados ao formattedProfile no futuro, estas condições irão incluí-los.
        if (talentData.email) { 
            talentPayload.email = talentData.email;
        }
        if (talentData.phone) { 
            talentPayload.phone = talentData.phone;
        }
        if (talentData.location) {
            talentPayload.location = talentData.location;
        }
        if (talentData.company) { 
            talentPayload.company = talentData.company;
        }
        
        // Outros campos como 'jobTitle', 'summary', 'experience', 'education', 'skills'
        // foram removidos na iteração anterior porque não são permitidos na API de criação.

        log("Criando novo talento com os dados (payload filtrado):", talentPayload); // Log para ver o payload real
        
        const newTalent = await createTalent(talentPayload); // Envie o payload filtrado
        if (!newTalent) throw new Error("A API da InHire falhou ao criar o novo talento.");

        log(`Talento criado com sucesso: ${newTalent.name}`);
        
        // Invalida o cache de talentos, pois a lista mudou.
        clearCacheByPrefix('talents_page_');

        return { success: true, talent: newTalent };

    } catch(err) {
        error("Erro em handleConfirmCreation:", err.message);
        return { success: false, error: err.message };
    }
}

export const handleEditTalent = async (talentId, dataToUpdate) => {
  log(`--- ORQUESTRADOR: Editando talento ${talentId} ---`);
  const success = await updateTalent(talentId, dataToUpdate);
  if (!success) {
    return { success: false, error: "Falha ao atualizar dados do talento." };
  }
  // Invalida o cache de talentos, pois um item foi alterado.
  clearCacheByPrefix('talents_page_');
  return { success: true };
};

export const handleDeleteTalent = async (talentId) => {
  log(`--- ORQUESTRADOR: Deletando talento ${talentId} ---`);
  const success = await deleteTalent(talentId);
  if (!success) {
    return { success: false, error: "Falha ao excluir talento." };
  }
  // Invalida o cache de talentos, pois um item foi removido.
  clearCacheByPrefix('talents_page_');
  return { success: true };
};