// src/controllers/linkedinPdf.controller.js
// Controller para baixar e processar o PDF do LinkedIn usando cookies de sessão

import axios from 'axios';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
import { log, error as logError } from '../utils/logger.service.js';

/**
 * Extrai o username/slug de uma URL do LinkedIn
 * @param {string} profileUrl - A URL do perfil do LinkedIn
 * @returns {string|null} O username extraído ou null
 */
const extractUsernameFromUrl = (profileUrl) => {
    try {
        const match = profileUrl.match(/linkedin\.com\/in\/([^/?]+)/);
        return match ? decodeURIComponent(match[1]) : null;
    } catch (error) {
        return null;
    }
};

/**
 * Função auxiliar para limpar texto
 */
const cleanText = (text) => text?.replace(/\s+/g, ' ').trim() || '';

/**
 * Parseia o buffer do PDF do LinkedIn e extrai dados estruturados
 * @param {Buffer} pdfBuffer - O buffer do PDF
 * @returns {Promise<object>} Os dados estruturados do perfil
 */
const parseLinkedInPdf = async (pdfBuffer) => {
    const data = await pdf(pdfBuffer);
    const lines = data.text.split('\n').filter(line => line.trim() !== '');

    log(`[PDF Parser] Total de linhas extraídas: ${lines.length}`);

    // Estrutura base do perfil
    const profileData = {
        nome: lines[0] ? cleanText(lines[0]) : null,
        headline: lines[1] ? cleanText(lines[1]) : null,
        resumo: '',
        experiencias: [],
        formacao: [],
        competencias: [],
        idiomas: [],
        certificacoes: [],
        textoCompleto: data.text
    };

    let currentSection = '';

    for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Detecta o início de uma nova seção
        if (line === 'Resumo' || line === 'Summary') {
            currentSection = 'resumo';
            continue;
        }
        if (line === 'Experiência' || line === 'Experience') {
            currentSection = 'experiencia';
            continue;
        }
        if (line === 'Formação acadêmica' || line === 'Education') {
            currentSection = 'formacao';
            continue;
        }
        if (line === 'Principais competências' || line === 'Top Skills' || line === 'Skills') {
            currentSection = 'competencias';
            continue;
        }
        if (line === 'Idiomas' || line === 'Languages') {
            currentSection = 'idiomas';
            continue;
        }
        if (line === 'Licenças e certificados' || line === 'Certifications') {
            currentSection = 'certificacoes';
            continue;
        }
        if (line.startsWith('Página') || line.startsWith('Page')) {
            // Ignora rodapés de página
            continue;
        }

        // Processa a linha de acordo com a seção atual
        switch (currentSection) {
            case 'resumo':
                profileData.resumo += ` ${line}`;
                break;

            case 'experiencia':
                // Experiência geralmente tem: Cargo, Empresa, Período
                if (i + 2 < lines.length) {
                    profileData.experiencias.push({
                        cargo: cleanText(line),
                        empresa: cleanText(lines[i + 1] || ''),
                        periodo: cleanText(lines[i + 2] || ''),
                        descricao: ''
                    });
                    i += 2; // Pula as linhas já processadas
                }
                break;

            case 'formacao':
                // Formação geralmente tem: Instituição, Curso, Período
                if (i + 2 < lines.length) {
                    profileData.formacao.push({
                        instituicao: cleanText(line),
                        curso: cleanText(lines[i + 1] || ''),
                        periodo: cleanText(lines[i + 2] || '')
                    });
                    i += 2;
                }
                break;

            case 'competencias':
                // Competências geralmente vêm em uma linha, separadas por "·" ou vírgulas
                const skills = line.split(/·|,/g).map(s => s.trim()).filter(Boolean);
                profileData.competencias.push(...skills);
                break;

            case 'idiomas':
                // Idiomas geralmente vêm como "Idioma (Nível)"
                profileData.idiomas.push(cleanText(line));
                break;

            case 'certificacoes':
                profileData.certificacoes.push(cleanText(line));
                break;
        }
    }

    // Limpa o resumo
    profileData.resumo = cleanText(profileData.resumo);

    // Remove textoCompleto para reduzir tamanho da resposta (opcional)
    // delete profileData.textoCompleto;

    return profileData;
};

/**
 * Endpoint principal: recebe profileUrl e cookies,
 * baixa o PDF do LinkedIn e retorna os dados extraídos.
 */
export const fetchLinkedInProfilePdf = async (req, res) => {
    const { profileUrl, liAtCookie, csrfToken } = req.body;

    // Validações
    if (!profileUrl) {
        return res.status(400).json({
            error: 'O campo profileUrl é obrigatório.'
        });
    }

    if (!liAtCookie) {
        return res.status(400).json({
            error: 'O campo liAtCookie é obrigatório. O usuário precisa estar logado no LinkedIn.'
        });
    }

    const username = extractUsernameFromUrl(profileUrl);
    if (!username) {
        return res.status(400).json({
            error: 'URL do LinkedIn inválida. Use o formato: https://www.linkedin.com/in/username'
        });
    }

    log(`--- LINKEDIN PDF: Iniciando fetch para: ${username} ---`);

    try {
        // Monta os headers de autenticação
        const headers = {
            'Cookie': `li_at=${liAtCookie}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/octet-stream, application/pdf',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'X-Li-Lang': 'pt_BR',
            'X-RestLi-Protocol-Version': '2.0.0'
        };

        // Se temos o CSRF token, adiciona ao header
        if (csrfToken) {
            headers['csrf-token'] = `ajax:${csrfToken}`;
            headers['Cookie'] += `; JSESSIONID="${csrfToken}"`;
        }

        log(`[LINKEDIN PDF] Fazendo requisição para o endpoint do LinkedIn...`);

        // Requisição ao endpoint interno do LinkedIn
        // O endpoint pode variar, tentamos diferentes formatos
        let response;
        const endpoints = [
            `https://www.linkedin.com/voyager/api/identity/profiles/${username}/profileToPdf`,
            `https://www.linkedin.com/voyager/api/me/profileToPdf?profileId=${username}`,
            `https://www.linkedin.com/in/${username}/overlay/download-pdf/`
        ];

        let lastError = null;
        for (const endpoint of endpoints) {
            try {
                log(`[LINKEDIN PDF] Tentando endpoint: ${endpoint}`);
                response = await axios.get(endpoint, {
                    headers,
                    responseType: 'arraybuffer',
                    timeout: 30000, // 30 segundos timeout
                    maxRedirects: 5,
                    validateStatus: (status) => status < 400 // Aceita 2xx e 3xx
                });

                // Se chegou aqui, a requisição foi bem sucedida
                if (response.data && response.data.byteLength > 0) {
                    log(`[LINKEDIN PDF] ✅ Sucesso com endpoint: ${endpoint}`);
                    break;
                }
            } catch (endpointError) {
                lastError = endpointError;
                log(`[LINKEDIN PDF] ⚠️ Falha no endpoint ${endpoint}: ${endpointError.message}`);
                continue;
            }
        }

        if (!response || !response.data || response.data.byteLength === 0) {
            throw lastError || new Error('Nenhum endpoint retornou dados válidos');
        }

        // Verifica se recebemos um PDF válido
        const pdfBuffer = Buffer.from(response.data);
        log(`[LINKEDIN PDF] Tamanho do PDF recebido: ${pdfBuffer.length} bytes`);

        // Verifica a assinatura do PDF (deve começar com %PDF)
        const pdfSignature = pdfBuffer.slice(0, 4).toString();
        if (pdfSignature !== '%PDF') {
            log(`[LINKEDIN PDF] ⚠️ Resposta não parece ser um PDF. Início: ${pdfSignature}`);

            // Pode ser uma resposta HTML de erro
            const responseText = pdfBuffer.toString('utf-8').slice(0, 500);
            logError(`[LINKEDIN PDF] Resposta recebida: ${responseText}`);

            return res.status(401).json({
                error: 'Não foi possível baixar o PDF. Verifique se o cookie está válido e tente novamente.',
                details: 'A resposta do LinkedIn não foi um PDF válido.'
            });
        }

        // Processa o PDF
        log(`[LINKEDIN PDF] Processando PDF...`);
        const profileData = await parseLinkedInPdf(pdfBuffer);

        log('✅ LINKEDIN PDF: Extração concluída com sucesso.');
        log(`[LINKEDIN PDF] Dados extraídos: Nome=${profileData.nome}, Competências=${profileData.competencias.length}`);

        res.status(200).json({
            success: true,
            profile: profileData
        });

    } catch (error) {
        logError('❌ LINKEDIN PDF: Erro ao processar:', error.message);

        // Tratamento específico de erros
        if (error.response) {
            const status = error.response.status;

            if (status === 401 || status === 403) {
                return res.status(401).json({
                    error: 'Cookie de sessão inválido ou expirado. Faça login novamente no LinkedIn.',
                    code: 'SESSION_EXPIRED'
                });
            }

            if (status === 404) {
                return res.status(404).json({
                    error: 'Perfil não encontrado no LinkedIn.',
                    code: 'PROFILE_NOT_FOUND'
                });
            }

            if (status === 429) {
                return res.status(429).json({
                    error: 'Muitas requisições. Aguarde alguns minutos antes de tentar novamente.',
                    code: 'RATE_LIMITED'
                });
            }
        }

        res.status(500).json({
            error: 'Erro ao buscar PDF do LinkedIn. Tente novamente mais tarde.',
            details: error.message
        });
    }
};

/**
 * Endpoint de verificação de status do cookie
 * Útil para verificar se o cookie ainda é válido antes de fazer o fetch
 */
export const checkLinkedInCookieStatus = async (req, res) => {
    const { liAtCookie } = req.body;

    if (!liAtCookie) {
        return res.status(400).json({
            valid: false,
            error: 'Cookie li_at não fornecido.'
        });
    }

    try {
        // Faz uma requisição simples ao LinkedIn para verificar se o cookie é válido
        const response = await axios.get('https://www.linkedin.com/voyager/api/me', {
            headers: {
                'Cookie': `li_at=${liAtCookie}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'X-RestLi-Protocol-Version': '2.0.0'
            },
            timeout: 10000
        });

        if (response.status === 200) {
            return res.status(200).json({
                valid: true,
                message: 'Cookie de sessão válido.'
            });
        }
    } catch (error) {
        if (error.response?.status === 401 || error.response?.status === 403) {
            return res.status(200).json({
                valid: false,
                error: 'Cookie de sessão expirado ou inválido.'
            });
        }
    }

    res.status(200).json({
        valid: false,
        error: 'Não foi possível verificar o status do cookie.'
    });
};
