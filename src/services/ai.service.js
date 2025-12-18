// ARQUIVO ATUALIZADO: src/services/ai.service.js

import { OpenAI } from 'openai';
import { log, error as logError } from '../utils/logger.service.js';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 100000, // Timeout aumentado
    maxRetries: 2
});

// ==========================================================
// MUDANÇA PRINCIPAL APLICADA AQUI
// Esta função foi atualizada com um prompt muito mais rigoroso.
// ==========================================================
const analyzeCriterionWithGPT = async (criterion, relevantChunks) => {
    if (!relevantChunks || relevantChunks.length === 0) {
        return {
            name: criterion.name,
            score: 1, // A nota padrão para ausência de evidência é 1.
            justification: "Nenhuma evidência relevante encontrada no perfil."
        };
    }

    const limitedChunks = relevantChunks.slice(0, 3);

    // NOVO PROMPT: Personalidade Cética e Rubrica Rigorosa
    const prompt = `
        **Persona:** Você é um Tech Recruiter Sênior extremamente cético e rigoroso. Sua função é proteger a empresa de contratações ruins, exigindo provas claras e inequívocas no perfil do candidato.

        **Tarefa:** Avalie se as evidências abaixo, extraídas do perfil de um candidato, comprovam o critério de avaliação completo.
        
        **Critério Completo (avalie palavra por palavra):**
        "${criterion.name}"

        **Evidências Encontradas no Perfil:**
        ${limitedChunks.map((c, i) => `EVIDÊNCIA ${i + 1}: ${c}`).join('\n---\n')}

        **Rubrica de Avaliação (SEJA RIGOROSO):**
        -   **5 (Excepcional):** A evidência comprova o critério de forma explícita, direta e repetida. É inegável e impressionante.
        -   **4 (Forte):** A evidência é clara e direta, mas talvez em uma única menção forte.
        -   **3 (Parcial):** A evidência sugere o critério, mas não o comprova diretamente. Requer inferência. O candidato tangencia o ponto.
        -   **2 (Fraco):** A evidência é apenas vagamente relacionada. É uma suposição muito fraca.
        -   **1 (Inexistente):** **NÃO SEJA OTIMISTA.** Se não há prova clara e direta, a nota é 1. Na dúvida, a nota é 1. A ausência de evidência resulta em nota 1.

        **Formato da Resposta:**
        Responda APENAS com um objeto JSON, sem nenhum texto adicional.
        {"score": <sua nota de 1 a 5>, "justification": "<sua justificativa curta e direta>"}
    `;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0, // Temperatura 0 para respostas mais factuais e menos criativas.
            max_tokens: 150
        });

        const result = JSON.parse(response.choices[0].message.content);
        return {
            name: criterion.name,
            score: result.score || 1,
            justification: result.justification || "Análise incompleta"
        };
    } catch (err) {
        logError(`Erro ao avaliar (com prompt rigoroso) "${criterion.name}":`, err.message);
        return {
            name: criterion.name,
            score: 1,
            justification: "Erro na análise da IA"
        };
    }
};

// A função de execução em lote permanece a mesma, pois a performance é mantida.
export const analyzeAllCriteriaInBatch = async (criteriaWithChunks) => {
    const startTime = Date.now();
    log(`Análise em PARALELO de ${criteriaWithChunks.length} critérios (com prompt rigoroso)...`);

    try {
        const allPromises = criteriaWithChunks.map(({ criterion, chunks }) =>
            analyzeCriterionWithGPT(criterion, chunks)
        );

        const results = await Promise.all(allPromises);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        log(`✓ Análise em PARALELO (rigorosa) concluída em ${duration}s. Todas as ${results.length} avaliações recebidas.`);

        return results;

    } catch (err) {
        logError('Erro crítico durante a análise em paralelo (rigorosa):', err.message);
        return criteriaWithChunks.map(({ criterion }) => ({
            name: criterion.name,
            score: 1,
            justification: "Falha geral na análise paralela"
        }));
    }
};

/**
 * Normaliza os dados brutos extraídos do PDF usando um prompt específico para LLM.
 * @param {object} rawData - O objeto JSON bruto contendo 'textoCompleto'
 * @returns {Promise<object>} - O JSON normalizado conforme schema
 */
export const normalizeProfileData = async (rawData) => {

    // Otimização: Se não tiver texto completo, nem adianta chamar a IA.
    if (!rawData || (!rawData.textoCompleto && !rawData.resumo)) {
        logError('normalizeProfileData: Dados insuficientes para normalização.');
        return null;
    }

    log(`Iniciando normalização de perfil com LLM (${rawData.textoCompleto?.length || 0} chars)...`);

    const prompt = `
    Você é um AGENTE DE NORMALIZAÇÃO DE PERFIL PROFISSIONAL.

    Seu objetivo é transformar um JSON EXTRAÍDO DE LINKEDIN, DESORGANIZADO E COM RUÍDO,
    em um JSON CANÔNICO, LIMPO, DETERMINÍSTICO E PRONTO PARA VETORIZAÇÃO.

    ────────────────────────────────
    REGRAS ABSOLUTAS (NUNCA QUEBRE)
    ────────────────────────────────

    1. NÃO invente informações
    2. NÃO traduza textos
    3. NÃO resuma descrições
    4. NÃO altere o sentido original
    5. NÃO use linguagem criativa
    6. NÃO use emojis
    7. NÃO gere texto novo
    8. NÃO misture experiências
    9. NÃO utilize LLM para inferência semântica
    10. TODA transformação deve ser justificável por regra lógica

    Seu papel NÃO é interpretar o currículo.
    Seu papel é ORGANIZAR DADOS EXISTENTES.

    ────────────────────────────────
    ENTRADA
    ────────────────────────────────
    JSON BRUTO:
    ${JSON.stringify(rawData, null, 2)}

    ────────────────────────────────
    SAÍDA OBRIGATÓRIA (SCHEMA)
    ────────────────────────────────

    {
      "perfil": {
        "nome": string | null,
        "titulo": string | null,
        "linkedin": string | null,
        "localizacao": string | null
      },
      "resumo": string | null,
      "experiencias": [
        {
          "empresa": string,
          "cargo": string,
          "localizacao": string | null,
          "inicio": string | null, // Formato YYYY-MM ou null
          "fim": string | null,    // Formato YYYY-MM ou null
          "descricao": string
        }
      ],
      "formacao": [
        {
          "instituicao": string,
          "curso": string,
          "inicio": string | null,
          "fim": string | null
        }
      ],
      "skills": string[],
      "certificacoes": string[]
    }

    ────────────────────────────────
    PROCESSO OBRIGATÓRIO
    ────────────────────────────────

    ETAPA 1 — LIMPEZA
    - Remova: Page X of Y, -- X of Y --, Quebras de página
    - Preserve parágrafos

    ETAPA 2 — PERFIL
    - Nome: primeira ocorrência clara
    - Linkedin: URL válida
    - Localização: cidade/país explícito
    - Título: linha curta com função principal

    ETAPA 3 — RESUMO
    - Use APENAS o bloco "Resumo"

    ETAPA 4 — EXPERIÊNCIAS
    - Parse datas: "outubro de 2025" -> "2025-10", "Present" -> null
    - Descrição: Texto entre datas e próxima experiência

    ETAPA 5 — FORMAÇÃO
    - Apenas acadêmica

    ETAPA 6 — SKILLS
    - Apenas técnicas, unicas, normalizadas.

    ETAPA 7 — VALIDAÇÃO
    - JSON válido apenas.

    RETORNE APENAS O JSON FINAL.
    `;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o", // Usando modelo mais capaz para parsing complexo
            messages: [{ role: "system", content: prompt }], // System prompt é melhor para instrução
            response_format: { type: "json_object" },
            temperature: 0,
        });

        const normalizedData = JSON.parse(response.choices[0].message.content);
        log('✅ Perfil normalizado com sucesso via LLM.');
        return normalizedData;

    } catch (err) {
        logError('❌ Erro na normalização com LLM:', err.message);
        // Fallback: retorna o dado original se der erro, mas idealmente deveria tratar
        return rawData;
    }
};