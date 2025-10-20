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

export const evaluateScorecardFromCache = async (talentId, jobDetails, scorecard, weights) => {
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
    const allSkillsWithWeights = scorecard.skillCategories.flatMap(cat => 
        (cat.skills || []).map(skill => ({
            id: skill.id,
            name: skill.name,
            weight: weightMap[weights[skill.id] || 2]
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
        2.  **Considere os Pesos:** Preste muita atenção na prioridade de cada critério. Critérios com peso 'Alto' são cruciais. Sua avaliação deve refletir essa importância.
        3.  **Avalie CADA Critério:** Para cada critério na lista, analise o perfil e atribua uma nota de 0 a 5 e uma justificativa curta (1-2 frases).
            - **Rubrica:** 5 (Evidência forte), 3-4 (Evidência clara), 1-2 (Evidência fraca), 0 (Nenhuma evidência).
        4.  **Escreva o Feedback Geral:** Com base em todas as suas avaliações ponderadas, escreva um parágrafo conciso (2-4 frases) resumindo a adequação do candidato.
        5.  **Tome a Decisão Final:** Sugira uma decisão: "YES", "NO", ou "NO_DECISION".

        **Formato OBRIGATÓRIO da Resposta:**
        Responda APENAS com um objeto JSON válido.
        {
          "evaluations": [ { "id": "ID_DO_CRITERIO_1", "score": <nota>, "justification": "<justificativa>" } ],
          "overallFeedback": "<feedback geral>",
          "finalDecision": "<sua decisão>"
        }
    `;

    try {
        const response = await axios.post(OPENAI_API_URL, {
            model: "gpt-3.5-turbo-0125",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
        }, {
            headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
        });
        const result = JSON.parse(response.data.choices[0].message.content);
        log(`IA (GPT-3.5) retornou avaliação completa do scorecard.`);
        return result;
    } catch (err) {
        error("Erro ao chamar a API da OpenAI para avaliação de scorecard:", err.response?.data || err.message);
        throw err;
    }
};

export const getAIEvaluationCacheStatus = async (talentId) => {
    const talentInHire = await getTalentById(talentId);
    if (!talentInHire?.linkedinUsername) return { hasCache: false, lastScrapedAt: null };
    return getCacheStatus(talentInHire.linkedinUsername);
};

export const mapProfileToInhireSchemaWithAI = async (scrapedProfileData, talentFields, jobTalentFields) => {
    log(`--- ORQUESTRADOR IA: Mapeando perfil de "${scrapedProfileData.name}" para o schema completo da InHire ---`);
    if (!OPENAI_API_KEY) throw new Error("A chave da API da OpenAI não está configurada.");

    const prompt = `
        Você é um especialista em recrutamento e um analista de dados sênior. Sua missão é analisar um dossiê de dados brutos de um perfil do LinkedIn e preencher de forma autônoma e completa o schema de dados de um sistema de recrutamento (ATS).

        **FERRAMENTA 1: Dossiê do Candidato (Fonte de Evidências)**
        Este JSON contém todas as informações disponíveis sobre o candidato. Analise-o holisticamente.
        ${JSON.stringify(scrapedProfileData, null, 2)}

        **FERRAMENTA 2: Schema do Talento (Destino 1)**
        Estes são os campos GERAIS disponíveis para o perfil do talento.
        ${JSON.stringify(talentFields, null, 2)}

        **FERRAMENTA 3: Schema da Candidatura (Destino 2)**
        Estes são os campos PERSONALIZADOS específicos para uma candidatura.
        ${JSON.stringify(jobTalentFields, null, 2)}

        **SUA TAREFA (PROCESSO ANALÍTICO):**
        1.  **Entendimento Completo:** Leia o Dossiê para entender quem é o candidato.
        2.  **Preenchimento do Schema do Talento:** Para cada campo no "Schema do Talento", encontre a informação correspondente no Dossiê.
        3.  **Preenchimento do Schema da Candidatura:** Para cada campo no "Schema da Candidatura", encontre a informação correspondente no Dossiê. Use sua inteligência para interpretar dados:
            -   Se um campo personalizado for "Cargo Atual", use o 'jobTitle' do dossiê.
            -   Para campos de seleção (select), analise o contexto (cargo, descrição) para escolher a opção mais adequada da lista 'options' e retorne o objeto completo da opção.
            -   Infira o gênero a partir do nome.
        4.  **Regra de Ouro:** Não invente dados. Se não houver evidência para um campo, omita-o do seu JSON de resposta.

        **Formato OBRIGATÓRIO da Resposta:**
        Responda APENAS com um único objeto JSON que tenha duas chaves principais: 'talentPayload' e 'applicationPayload'.
        
        **Exemplo de Resposta Perfeita:**
        {
          "talentPayload": {
            "location": "São Paulo, Brasil",
            "company": "Google"
          },
          "applicationPayload": {
            "customFields": [
              {
                "id": "ID_DO_CAMPO_CARGO",
                "name": "Cargo",
                "type": "text",
                "value": "Engenheiro de Software Sênior"
              },
              {
                "id": "ID_DO_CAMPO_SEXO",
                "name": "Sexo",
                "type": "select",
                "value": { "id": "f054fecc...", "value": "Masculino", "label": "Masculino" }
              }
            ]
          }
        }
    `;

    try {
        const response = await axios.post(OPENAI_API_URL, {
            model: "gpt-3.5-turbo-0125",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
        }, {
            headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
        });
        const result = JSON.parse(response.data.choices[0].message.content);
        log(`IA (GPT-3.5) concluiu o mapeamento autônomo para "${scrapedProfileData.name}".`);
        return result;
    } catch (err) {
        error("Erro ao chamar a IA para mapeamento autônomo:", err.response?.data || err.message);
        throw err;
    }
};