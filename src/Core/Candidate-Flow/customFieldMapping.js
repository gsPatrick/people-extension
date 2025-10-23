// ARQUIVO FINAL E COMPLETO: src/Core/Candidate-Flow/customFieldMapping.js

import { getGenderByName } from '../../utils/gender.service.js';

// ===================================================================
// FUNÇÕES AUXILIARES DE TRANSFORMAÇÃO
// ===================================================================

/**
 * Extrai o nome do estado de uma string de localização (ex: "São Paulo, São Paulo, Brasil").
 * @param {string} locationString - A localização completa.
 * @returns {string|null} O estado ou null se não puder ser extraído.
 */
function extractStateFromLocation(locationString) {
    if (!locationString) return null;
    const parts = locationString.split(',').map(p => p.trim());
    // Ex: "São Paulo, São Paulo, Brasil" -> parts[1] é "São Paulo"
    if (parts.length >= 2) {
        return parts[1];
    }
    return locationString; // Retorna a string original como fallback
}

/**
 * Mapeia um título de cargo para um nível hierárquico pré-definido.
 * @param {string} jobTitle - O título do cargo vindo do LinkedIn.
 * @param {Array<object>} fieldOptions - As opções disponíveis no campo 'select' da InHire.
 * @returns {object|null} O objeto de opção da InHire ou null.
 */
function mapJobTitleToLevel(jobTitle, fieldOptions) {
    if (!jobTitle || !Array.isArray(fieldOptions)) return null;
    const title = jobTitle.toLowerCase();

    // Mapeia da posição mais alta para a mais baixa para evitar falsos positivos
    if (title.includes('ceo') || title.includes('cto') || title.includes('c-level') || title.includes('chief') || title.includes('founder') || title.includes('fundador')) return fieldOptions.find(o => o.value?.toLowerCase().includes('c-level'));
    if (title.includes('director') || title.includes('diretor') || title.includes('head of')) return fieldOptions.find(o => o.value?.toLowerCase().includes('diretor'));
    if (title.includes('manager') || title.includes('gerente') || title.includes('coordenador')) return fieldOptions.find(o => o.value?.toLowerCase().includes('gerente'));
    if (title.includes('specialist') || title.includes('especialista') || title.includes('sr.') || title.includes('sênior')) return fieldOptions.find(o => o.value?.toLowerCase().includes('especialista'));
    if (title.includes('analyst') || title.includes('analista')) return fieldOptions.find(o => o.value?.toLowerCase().includes('analista'));
    if (title.includes('intern') || title.includes('estagiário')) return fieldOptions.find(o => o.value?.toLowerCase().includes('estagiário'));
    
    return null;
}

/**
 * Formata o histórico de carreira a partir do array de experiências.
 * @param {Array<object>} experienceArray - O array de experiências do scraper.
 * @returns {string|null} Uma string formatada ou null.
 */
function formatCareerHistory(experienceArray) {
    if (!Array.isArray(experienceArray) || experienceArray.length === 0) return null;
    return experienceArray
        .map(exp => `${exp.title} na ${exp.companyName} (${exp.dateRange || 'N/D'})`)
        .join('\n');
}

/**
 * Formata o histórico de educação.
 * @param {Array<object>} educationArray - O array de educação do scraper.
 * @returns {string|null} Uma string formatada ou null.
 */
function formatEducationHistory(educationArray) {
    if (!Array.isArray(educationArray) || educationArray.length === 0) return null;
    return educationArray
        .map(edu => `${edu.degree || 'Formação'} em ${edu.schoolName} (${edu.dateRange || 'N/D'})`)
        .join('; ');
}

// ===================================================================
// MAPEADOR PRINCIPAL
// ===================================================================

/**
 * Função central que mapeia os dados do scraping para os payloads da API da InHire.
 * @param {object} scrapedData - Os dados brutos do LinkedIn.
 * @param {Array<object>} customFieldDefinitions - As definições dos campos vindas da API InHire.
 * @returns {Promise<{talentPayload: object, customFieldsPayload: Array<object>}>} Payloads prontos para a API.
 */
export const mapProfileToInhirePayloads = async (scrapedData, customFieldDefinitions) => {
    
    // --- 1. Payload para os campos GERAIS do talento ---
    const talentPayload = {
        name: scrapedData.name,
        headline: scrapedData.headline,
        linkedinUsername: scrapedData.linkedinUsername,
        location: scrapedData.location,
        // Pega a empresa da primeira experiência listada, que é a mais recente
        company: scrapedData.experience?.[0]?.companyName || null, 
    };

    // --- 2. Payload para os CAMPOS PERSONALIZADOS da candidatura ---
    const customFieldsPayload = [];

    for (const field of customFieldDefinitions) {
        let value = null;
        const fieldName = field.name.toLowerCase();
        const firstName = scrapedData.name ? scrapedData.name.split(' ')[0] : null;

        // Lógica de mapeamento baseada no nome do campo (case-insensitive)
        if (fieldName.includes('empresa atual')) {
            value = talentPayload.company; // Usa o mesmo valor já definido
        } else if (fieldName.includes('sexo')) {
            const genderOptions = field.answerOptions || [];
            if (firstName) {
                const gender = await getGenderByName(firstName);
                if (gender === 'male') value = genderOptions.find(o => o.value?.toLowerCase().includes('masculino'));
                if (gender === 'female') value = genderOptions.find(o => o.value?.toLowerCase().includes('feminino'));
            }
        } else if (fieldName.includes('universidade') || (fieldName.includes('formação') && !fieldName.includes('complemento'))) {
            // Pega o nome da primeira instituição de ensino
            value = scrapedData.education?.[0]?.schoolName || null;
        } else if (fieldName.includes('complemento de formação')) {
            value = formatEducationHistory(scrapedData.education);
        } else if (fieldName.includes('cargo')) {
            value = scrapedData.experience?.[0]?.title || null;
        } else if (fieldName.includes('nível hierárquico')) {
            const currentJobTitle = scrapedData.experience?.[0]?.title || null;
            value = mapJobTitleToLevel(currentJobTitle, field.answerOptions);
        } else if (fieldName.includes('estado') || fieldName.includes('uf')) {
            value = extractStateFromLocation(scrapedData.location);
        } else if (fieldName.includes('carreira') || fieldName.includes('experiência')) {
            value = formatCareerHistory(scrapedData.experience);
        } else if (fieldName.includes('competências') || fieldName.includes('skills')) {
            if (Array.isArray(scrapedData.skills) && scrapedData.skills.length > 0) {
                value = scrapedData.skills.map(skill => skill.name).join(', ');
            }
        } else if (fieldName.includes('idiomas')) {
            if (Array.isArray(scrapedData.languages) && scrapedData.languages.length > 0) {
                value = scrapedData.languages.map(lang => lang.language).join(', ');
            }
        }

        // Adiciona ao payload final se um valor foi encontrado e é válido
        if (value !== null && value !== undefined && value !== '') {
            customFieldsPayload.push({
                id: field.id,
                name: field.name,
                type: field.type,
                value: value
            });
        }
    }

    return { talentPayload, customFieldsPayload };
};