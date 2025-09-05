// src/Core/AI-Flow/aiOrchestrator.js

import axios from 'axios';
import 'dotenv/config';
import { log, error } from '../../utils/logger.service.js';
import { getTalentById } from '../../Inhire/Talents/talents.service.js';
import { extractProfileData } from '../../Linkedin/profile.service.js';
import { getCachedProfile, saveCachedProfile, getCacheStatus } from '../../Platform/Cache/cache.service.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export const syncProfileFromLinkedIn = async (talentId) => {
    log(`--- ORQUESTRADOR IA: Sincronizando perfil do Talento ID: ${talentId} ---`);
    try {
        const talentInHire = await getTalentById(talentId);
        if (!talentInHire) throw new Error(`Talento com ID ${talentId} não encontrado.`);
        const linkedinUsername = talentInHire.linkedinUsername;
        if (!linkedinUsername) throw new Error(`O talento ${talentInHire.name} não possui um LinkedIn associado.`);
        log(`Forçando scraping para "${linkedinUsername}"...`);
        const profileUrl = `https://www.linkedin.com/in/${linkedinUsername}/`;
        const richProfileData = await extractProfileData(profileUrl);
        if (!richProfileData) throw new Error(`Falha ao extrair dados do LinkedIn para ${profileUrl}.`);
        saveCachedProfile(linkedinUsername, richProfileData);
        return { success: true, message: 'Perfil sincronizado com sucesso.', lastScrapedAt: Date.now() };
    } catch (err) {
        error("Erro ao forçar sincronização de perfil:", err.message);
        throw err;
    }
};

export const evaluateScorecardFromCache = async (talentId, jobDetails, scorecard, weights) => { // <<< 1. Adicionar weights aqui
    log(`--- ORQUESTRADOR IA: Avaliando SCORECARD COMPLETO para Talento ID: ${talentId} ---`);
    try {
        const talentInHire = await getTalentById(talentId);
        if (!talentInHire) throw new Error(`Talento com ID ${talentId} não encontrado.`);
        const linkedinUsername = talentInHire.linkedinUsername;
        if (!linkedinUsername) throw new Error(`O talento ${talentInHire.name} não possui um LinkedIn associado.`);
        const cached = getCachedProfile(linkedinUsername);
        if (!cached) {
            throw new Error('Dados do perfil não encontrados no cache. Por favor, sincronize com o LinkedIn primeiro.');
        }
        // <<< 2. Passar os weights para a função da IA >>>
        return await evaluateEntireScorecardWithAI(cached.profile, jobDetails, scorecard, weights);
    } catch (err) {
        error("Erro na avaliação do scorecard a partir do cache:", err.message);
        throw err;
    }
};

const evaluateEntireScorecardWithAI = async (candidateProfileData, jobDetails, scorecard, weights) => {
    log(`Enviando perfil de "${candidateProfileData.name}" para análise completa com pesos.`);
    if (!OPENAI_API_KEY) throw new Error("A chave da API da OpenAI (OPENAI_API_KEY) não está configurada no .env");

    const weightMap = { 1: 'Baixo', 2: 'Médio', 3: 'Alto' };

    // <<< MODIFICAÇÃO CHAVE: Combinando skills com seus pesos para enviar à IA >>>
    const allSkillsWithWeights = scorecard.skillCategories.flatMap(cat => 
        cat.skills.map(skill => ({
            id: skill.id,
            name: skill.name,
            weight: weightMap[weights[skill.id] || 2] // Converte o número do peso em texto (Baixo, Médio, Alto)
        }))
    );

    const prompt = `
        Você é um Tech Recruiter Sênior, especialista em realizar análises profundas de perfis do LinkedIn.
        Sua tarefa é avaliar o perfil de um candidato para TODOS os critérios de um scorecard, DENTRO DO CONTEXTO de uma vaga, **levando em consideração a prioridade (peso) de cada critério.**

        **Dados da Vaga (Contexto):**
        ${JSON.stringify(jobDetails, null, 2)}

        **Dados do Candidato (JSON):**
        ${JSON.stringify(candidateProfileData, null, 2)}

        **Critérios do Scorecard e Suas Prioridades (Pesos):**
        ${JSON.stringify(allSkillsWithWeights, null, 2)}

        **Seu Processo de Análise (Siga estritamente):**
        1.  **Entenda o Contexto:** Leia os detalhes da vaga e do candidato.
        2.  **Considere os Pesos:** Preste muita atenção na prioridade de cada critério. Critérios com peso 'Alto' são cruciais para a vaga. Critérios com peso 'Baixo' são apenas desejáveis. Sua avaliação e nota devem refletir essa importância. Uma ausência em um critério 'Alto' é muito mais grave do que em um 'Baixo'.
        3.  **Avalie CADA Critério:** Para cada critério na lista, analise o perfil e atribua uma nota de 0 a 5 e uma justificativa curta (1-2 frases).
            - **Rubrica de Notas (influenciada pelo peso):**
              - 5: Evidência forte e direta, especialmente em critérios de peso Alto/Médio.
              - 3-4: Evidência clara, mas talvez menos detalhada.
              - 1-2: Evidência fraca ou indireta. Uma nota baixa em um critério 'Alto' deve ser justificada claramente.
              - 0: Nenhuma evidência.
        4.  **Escreva o Feedback Geral:** Com base em todas as suas avaliações ponderadas, escreva um parágrafo conciso (2-4 frases) resumindo a adequação do candidato para a vaga, mencionando os pontos mais críticos (de peso alto).
        5.  **Tome a Decisão Final:** Com base na sua análise ponderada, sugira uma decisão. Responda com "YES" se o candidato parece um bom fit (especialmente nos critérios de peso alto), "NO" se parece um mau fit, ou "NO_DECISION" se for ambíguo.

        **Formato OBRIGATÓRIO da Resposta:**
        Responda APENAS com um objeto JSON válido, sem texto adicional.
        {
          "evaluations": [
            { "id": "ID_DO_CRITERIO_1", "score": <sua nota de 0 a 5>, "justification": "<sua justificativa>" }
          ],
          "overallFeedback": "<seu parágrafo de feedback geral aqui>",
          "finalDecision": "<sua decisão: 'YES', 'NO', ou 'NO_DECISION'>"
        }
    `;

    try {
        const response = await axios.post(OPENAI_API_URL, {
            model: "gpt-4-turbo-preview",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
        }, {
            headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
        });
        const result = JSON.parse(response.data.choices[0].message.content);
        log(`IA retornou avaliação completa do scorecard com pesos.`);
        return result;
    } catch (err) {
        error("Erro ao chamar a API da OpenAI:", err.response?.data || err.message);
        throw err;
    }
};

export const getAIEvaluationCacheStatus = async (talentId) => {
    const talentInHire = await getTalentById(talentId);
    if (!talentInHire?.linkedinUsername) return { hasCache: false, lastScrapedAt: null };
    return getCacheStatus(talentInHire.linkedinUsername);
};
/**
 * [AÇÃO RÁPIDA] Avalia um critério usando os dados em cache.
 * Esta função é chamada pelo botão "IA" ao lado de cada critério.
 * @param {string} talentId - O ID do talento na InHire.
 * @param {object} jobDetails - Detalhes da vaga para contexto.
 * @param {object} skillToEvaluate - O critério a ser avaliado.
 * @returns {Promise<{score: number, justification: string}>}
 */
export const evaluateSkillFromCache = async (talentId, jobDetails, skillToEvaluate) => {
    log(`--- ORQUESTRADOR IA: Avaliando critério a partir do cache para Talento ID: ${talentId} ---`);
    try {
        const talentInHire = await getTalentById(talentId);
        if (!talentInHire) throw new Error(`Talento com ID ${talentId} não encontrado.`);
        
        const linkedinUsername = talentInHire.linkedinUsername;
        if (!linkedinUsername) throw new Error(`O talento ${talentInHire.name} não possui um LinkedIn associado.`);
        
        const cached = getCachedProfile(linkedinUsername);
        if (!cached) {
            throw new Error('Dados do perfil não encontrados no cache. Por favor, sincronize com o LinkedIn primeiro.');
        }

        return await evaluateSkillWithAI(cached.profile, jobDetails, skillToEvaluate);

    } catch (err) {
        error("Erro na avaliação a partir do cache:", err.message);
        throw err;
    }
};

/**
 * Função interna que se comunica com a OpenAI para avaliar um perfil.
 * @param {object} candidateProfileData - Os dados ricos extraídos do LinkedIn.
 * @param {object} jobDetails - Detalhes da vaga para contexto.
 * @param {object} skillToEvaluate - O critério a ser avaliado.
 */
const evaluateSkillWithAI = async (candidateProfileData, jobDetails, skillToEvaluate) => {
    log(`Enviando perfil de "${candidateProfileData.name}" para análise do critério "${skillToEvaluate.name}" no contexto da vaga "${jobDetails.name}"`);
    if (!OPENAI_API_KEY) {
        throw new Error("A chave da API da OpenAI (OPENAI_API_KEY) não está configurada no .env");
    }

    const prompt = `
        Você é um Tech Recruiter Sênior, especialista em realizar análises profundas de perfis do LinkedIn.
        Sua tarefa é avaliar o perfil COMPLETO de um candidato para um critério de avaliação específico, DENTRO DO CONTEXTO de uma vaga.

        **Dados da Vaga (Contexto):**
        ${JSON.stringify(jobDetails, null, 2)}

        **Dados do Candidato (JSON):**
        ${JSON.stringify(candidateProfileData, null, 2)}

        **Critério Específico a ser Avaliado:**
        "${skillToEvaluate.name}"

        **Seu Processo de Análise (Siga estritamente):**
        1.  **Entenda o Contexto:** Leia os detalhes da vaga para entender o que é importante para esta posição.
        2.  **Examine o Perfil Completo:** Analise TODAS as seções do perfil do candidato (headline, description, experience, education, skills).
        3.  **Avalie o Critério vs. Contexto:** Se o critério for genérico como "experiência similar à do nosso cliente", use os dados da vaga para entender quem é o cliente e qual a natureza da empresa. Se o critério for um placeholder como "Colocar +5 competências", interprete isso como uma instrução para avaliar as competências mais relevantes do candidato para a vaga em questão. Tente sempre fornecer uma avaliação útil.
        4.  **Atribua a Nota (0 a 5):** Use a rubrica com base na FORÇA das evidências encontradas no perfil em relação à vaga.
            - **5/5:** Evidência explícita, forte e diretamente alinhada com as necessidades da vaga.
            - **3-4/5:** Evidência clara, mas talvez menos detalhada ou em experiências passadas.
            - **1-2/5:** Evidência fraca, indireta ou apenas tangencial.
            - **0/5:** Nenhuma evidência encontrada.
        5.  **Escreva a Justificativa:** Crie uma justificativa curta (1-2 frases). Mesmo que a nota seja 0, explique o porquê. Se você teve que interpretar um critério de placeholder, mencione isso brevemente (ex: "Avaliando as competências do perfil para a vaga...").

        **Formato OBRIGATÓRIO da Resposta:**
        Responda APENAS com um objeto JSON válido.
        {
          "score": <sua nota de 0 a 5>,
          "justification": "<sua justificativa>"
        }
    `;

    try {
        const response = await axios.post(OPENAI_API_URL, {
            model: "gpt-4-turbo-preview",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
        }, {
            headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
        });
        const result = JSON.parse(response.data.choices[0].message.content);
        log(`IA retornou para "${skillToEvaluate.name}": Nota ${result.score}, Justificativa: "${result.justification}"`);
        return result;
    } catch (err) {
        error("Erro ao chamar a API da OpenAI:", err.response?.data || err.message);
        throw err;
    }
};

