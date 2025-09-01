// src/Core/Candidate-Flow/customFieldMapping.js

import { getGenderByName } from '../../utils/gender.service.js';

// ===================================================================
// CONSTANTES DE MAPEAMENTO PARA CAMPOS 'SELECT' DA INHIRE
// TODO: Verifique e confirme se estes IDs estão corretos no seu ambiente InHire.
// ===================================================================

const GENDER_OPTIONS = {
    MALE:   { id: 'f054fecc-a8f5-4402-8bc5-996fc61cd7dd', value: 'Masculino', label: 'Masculino' },
    FEMALE: { id: 'ID_FEMININO_AQUI', value: 'Feminino', label: 'Feminino' } // <<< SUBSTITUIR ID
};

const HIERARCHICAL_LEVEL_OPTIONS = {
    ANALISTA:      { id: 'f966cf11-b515-4cd2-9474-c15a1653baa3', value: 'Analista', label: 'Analista' },
    ESPECIALISTA:  { id: 'ID_ESPECIALISTA_AQUI', value: 'Especialista', label: 'Especialista' }, // <<< SUBSTITUIR ID
    GERENTE:       { id: 'ID_GERENTE_AQUI', value: 'Gerente', label: 'Gerente' }, // <<< SUBSTITUIR ID
    DIRETOR:       { id: 'ID_DIRETOR_AQUI', value: 'Diretor', label: 'Diretor' }, // <<< SUBSTITUIR ID
    C_LEVEL:       { id: 'ID_C_LEVEL_AQUI', value: 'C-Level', label: 'C-Level' }, // <<< SUBSTITUIR ID
    ESTAGIARIO:    { id: 'ID_ESTAGIARIO_AQUI', value: 'Estagiário', label: 'Estagiário' } // <<< SUBSTITUIR ID
};

// ===================================================================
// FUNÇÕES AUXILIARES DE TRANSFORMAÇÃO
// ===================================================================

/**
 * Extrai o nome do estado de uma string de localização (ex: "Redmond, Washington, USA").
 * @param {string} locationString - A localização completa.
 * @returns {string} O estado ou a string original se o padrão não for encontrado.
 */
function extractStateFromLocation(locationString) {
    if (!locationString) return "";
    const parts = locationString.split(',').map(p => p.trim());
    if (parts.length >= 2) {
        // Assume que o estado é a penúltima parte se houver país, ou a última se não houver.
        // Ex: "Redmond, Washington, United States" -> parts[1] é "Washington"
        // Ex: "São Paulo, SP" -> parts[1] é "SP"
        return parts.length > 2 ? parts[1] : parts[parts.length -1];
    }
    return locationString; // Retorna a string original como fallback
}

/**
 * Mapeia um título de cargo para um nível hierárquico pré-definido.
 * @param {string} jobTitle - O título do cargo vindo do LinkedIn.
 * @returns {object|null} O objeto de opção da InHire ou null.
 */
function mapJobTitleToLevel(jobTitle) {
    if (!jobTitle) return null;
    const title = jobTitle.toLowerCase();

    if (title.includes('ceo') || title.includes('chairman') || title.includes('c-level') || title.includes('chief officer')) return HIERARCHICAL_LEVEL_OPTIONS.C_LEVEL;
    if (title.includes('director') || title.includes('diretor') || title.includes('head of')) return HIERARCHICAL_LEVEL_OPTIONS.DIRETOR;
    if (title.includes('manager') || title.includes('gerente') || title.includes('coordenador')) return HIERARCHICAL_LEVEL_OPTIONS.GERENTE;
    if (title.includes('specialist') || title.includes('especialista') || title.includes('sr.') || title.includes('sênior')) return HIERARCHICAL_LEVEL_OPTIONS.ESPECIALISTA;
    if (title.includes('analyst') || title.includes('analista')) return HIERARCHICAL_LEVEL_OPTIONS.ANALISTA;
    if (title.includes('intern') || title.includes('estagiário')) return HIERARCHICAL_LEVEL_OPTIONS.ESTAGIARIO;
    
    return null; // Nenhum nível correspondente encontrado
}

// ===================================================================
// MAPA PRINCIPAL DE TRANSFORMAÇÃO
// Chave: ID do campo personalizado da InHire.
// Valor: Objeto com o tipo e uma função `transform` que processa os dados do scraping.
// A função `transform` recebe o objeto `talentData` completo e deve retornar o valor final.
// ===================================================================

export const STATIC_FIELD_MAPPING = {
    '01': { // Empresa Atual
        type: 'text',
        transform: (data) => data.companyName || ""
    },
    '03': { // Sexo
        type: 'select',
        transform: async (data) => {
            const gender = await getGenderByName(data.firstName);
            if (gender === 'male') return GENDER_OPTIONS.MALE;
            if (gender === 'female') return GENDER_OPTIONS.FEMALE;
            return null; // Retorna null se não conseguir inferir
        }
    },
    '13': { // Universidade de Graduação
        type: 'text',
        transform: (data) => data.linkedinSchoolName || ""
    },
    '14': { // Complemento de formação (pós, mestrado, outros)
        type: 'text',
        transform: (data) => {
            // Concatena a formação anterior se existir
            const parts = [];
            if (data.linkedinPreviousSchoolName) {
                let degree = data.linkedinPreviousSchoolDegree ? ` - ${data.linkedinPreviousSchoolDegree}` : '';
                parts.push(`${data.linkedinPreviousSchoolName}${degree}`);
            }
            return parts.join('; ');
        }
    },
    // '15': { // Outro Idioma - O scraping atual não fornece essa informação
    //     type: 'text',
    //     transform: (data) => data.languages ? data.languages.join(', ') : ""
    // },
    '18': { // Cargo
        type: 'text',
        transform: (data) => data.linkedinJobTitle || ""
    },
    '19': { // Nível Hierárquico
        type: 'select',
        transform: (data) => mapJobTitleToLevel(data.linkedinJobTitle)
    },
    '22': { // Estado (UF)
        type: 'text',
        transform: (data) => extractStateFromLocation(data.location)
    },
    '23': { // Carreira
        type: 'text',
        transform: (data) => {
            const history = [];
            if (data.linkedinJobTitle && data.companyName) {
                history.push(`Atual: ${data.linkedinJobTitle} em ${data.companyName} (${data.linkedinJobDateRange || 'N/D'})`);
            }
            if (data.linkedinPreviousJobTitle && data.previousCompanyName) {
                history.push(`Anterior: ${data.linkedinPreviousJobTitle} em ${data.previousCompanyName} (${data.linkedinPreviousJobDateRange || 'N/D'})`);
            }
            return history.join('\n'); // Usa nova linha para separar
        }
    },
    // '24': { // Certificações - O scraping atual não fornece essa informação
    //     type: 'text',
    //     transform: (data) => data.certifications ? data.certifications.join(', ') : ""
    // },
};