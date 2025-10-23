// ARQUIVO ATUALIZADO: src/Core/Candidate-Flow/customFieldMapping.js

import { getGenderByName } from '../../utils/gender.service.js';
import { log } from '../../utils/logger.service.js'; // <-- MUDANÇA: Importar o logger

// ... (funções auxiliares como extractStateFromLocation, mapJobTitleToLevel, etc. permanecem iguais)
function extractStateFromLocation(locationString) {
    if (!locationString) return null;
    const parts = locationString.split(',').map(p => p.trim());
    if (parts.length >= 2) return parts[1];
    return locationString;
}
function mapJobTitleToLevel(jobTitle, fieldOptions) {
    if (!jobTitle || !Array.isArray(fieldOptions)) return null;
    const title = jobTitle.toLowerCase();
    if (title.includes('ceo') || title.includes('cto') || title.includes('c-level') || title.includes('chief') || title.includes('founder') || title.includes('fundador')) return fieldOptions.find(o => o.value?.toLowerCase().includes('c-level'));
    if (title.includes('director') || title.includes('diretor') || title.includes('head of')) return fieldOptions.find(o => o.value?.toLowerCase().includes('diretor'));
    if (title.includes('manager') || title.includes('gerente') || title.includes('coordenador')) return fieldOptions.find(o => o.value?.toLowerCase().includes('gerente'));
    if (title.includes('specialist') || title.includes('especialista') || title.includes('sr.') || title.includes('sênior')) return fieldOptions.find(o => o.value?.toLowerCase().includes('especialista'));
    if (title.includes('analyst') || title.includes('analista')) return fieldOptions.find(o => o.value?.toLowerCase().includes('analista'));
    if (title.includes('intern') || title.includes('estagiário')) return fieldOptions.find(o => o.value?.toLowerCase().includes('estagiário'));
    return null;
}
function formatCareerHistory(experienceArray) {
    if (!Array.isArray(experienceArray) || experienceArray.length === 0) return null;
    return experienceArray.map(exp => `${exp.title} na ${exp.companyName} (${exp.dateRange || 'N/D'})`).join('\n');
}
function formatEducationHistory(educationArray) {
    if (!Array.isArray(educationArray) || educationArray.length === 0) return null;
    return educationArray.map(edu => `${edu.degree || 'Formação'} em ${edu.schoolName} (${edu.dateRange || 'N/D'})`).join('; ');
}


export const mapProfileToInhirePayloads = async (scrapedData, customFieldDefinitions) => {
    log('--- INICIANDO MAPEAMENTO ESTÁTICO DETALHADO ---');
    
    const talentPayload = {
        name: scrapedData.name,
        headline: scrapedData.headline,
        linkedinUsername: scrapedData.linkedinUsername,
        location: scrapedData.location,
        company: scrapedData.experience?.[0]?.companyName || null, 
    };
    log(`[MAPEAMENTO] Payload Geral do Talento pré-montado.`);

    const customFieldsPayload = [];

    for (const field of customFieldDefinitions) {
        let value = null;
        const fieldName = field.name.toLowerCase();
        const firstName = scrapedData.name ? scrapedData.name.split(' ')[0] : null;

        // <-- MUDANÇA: Adicionado log para cada campo
        log(`[MAPEAMENTO] Processando campo: '${field.name}' (tipo: ${field.type})`);

        if (fieldName.includes('empresa atual')) {
            value = talentPayload.company;
        } else if (fieldName.includes('sexo')) {
            const genderOptions = field.answerOptions || [];
            if (firstName) {
                const gender = await getGenderByName(firstName);
                if (gender === 'male') value = genderOptions.find(o => o.value?.toLowerCase().includes('masculino'));
                if (gender === 'female') value = genderOptions.find(o => o.value?.toLowerCase().includes('feminino'));
            }
        } else if (fieldName.includes('universidade') || (fieldName.includes('formação') && !fieldName.includes('complemento'))) {
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

        // <-- MUDANÇA: Adicionado log para o valor encontrado
        log(`[MAPEAMENTO] Valor encontrado: ${JSON.stringify(value)}`);

        if (value !== null && value !== undefined && value !== '') {
            customFieldsPayload.push({ id: field.id, name: field.name, type: field.type, value: value });
        }
    }

    log('--- MAPEAMENTO ESTÁTICO CONCLUÍDO ---');
    return { talentPayload, customFieldsPayload };
};