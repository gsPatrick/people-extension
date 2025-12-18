// src/controllers/linkedinPdf.controller.js
// Controller para baixar e processar o PDF do LinkedIn usando cookies de sessão

import axios from 'axios';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
import { log, error as logError } from '../utils/logger.service.js';

/**
 * Extrai o username/slug de uma URL do LinkedIn
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
 */
const parseLinkedInPdf = async (pdfBuffer) => {
    const data = await pdf(pdfBuffer);
    const lines = data.text.split('\n').filter(line => line.trim() !== '');

    log(`[PDF Parser] Total de linhas extraídas: ${lines.length}`);

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
        if (line === 'Resumo' || line === 'Summary' || line === 'Sobre' || line === 'About') {
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
            continue;
        }

        switch (currentSection) {
            case 'resumo':
                profileData.resumo += ` ${line}`;
                break;
            case 'experiencia':
                if (i + 2 < lines.length) {
                    profileData.experiencias.push({
                        cargo: cleanText(line),
                        empresa: cleanText(lines[i + 1] || ''),
                        periodo: cleanText(lines[i + 2] || ''),
                        descricao: ''
                    });
                    i += 2;
                }
                break;
            case 'formacao':
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
                const skills = line.split(/·|,/g).map(s => s.trim()).filter(Boolean);
                profileData.competencias.push(...skills);
                break;
            case 'idiomas':
                profileData.idiomas.push(cleanText(line));
                break;
            case 'certificacoes':
                profileData.certificacoes.push(cleanText(line));
                break;
        }
    }

    profileData.resumo = cleanText(profileData.resumo);
    return profileData;
};

/**
 * Endpoint principal: recebe profileUrl e cookies,
 * baixa o PDF do LinkedIn e retorna os dados extraídos.
 */
export const fetchLinkedInProfilePdf = async (req, res) => {
    const { profileUrl, liAtCookie, csrfToken } = req.body;

    if (!profileUrl) {
        return res.status(400).json({ error: 'O campo profileUrl é obrigatório.' });
    }

    if (!liAtCookie) {
        return res.status(400).json({ error: 'O campo liAtCookie é obrigatório.' });
    }

    const username = extractUsernameFromUrl(profileUrl);
    if (!username) {
        return res.status(400).json({ error: 'URL do LinkedIn inválida.' });
    }

    log(`--- LINKEDIN PDF: Iniciando fetch para: ${username} ---`);

    try {
        // Monta a string completa de cookies para simular sessão real do navegador
        let cookieString = `li_at=${liAtCookie}`;

        // Adiciona JSESSIONID se disponível (importante para autenticação)
        if (csrfToken) {
            // Remove aspas se existirem
            const cleanCsrf = csrfToken.replace(/"/g, '');
            cookieString += `; JSESSIONID="${cleanCsrf}"`;
        }

        // Headers que simulam uma requisição real do navegador Chrome
        const baseHeaders = {
            'Cookie': cookieString,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/octet-stream, application/pdf, */*',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        };

        // Headers específicos para API do Voyager
        const voyagerHeaders = {
            ...baseHeaders,
            'Accept': 'application/vnd.linkedin.normalized+json+2.1',
            'x-li-lang': 'pt_BR',
            'x-li-page-instance': 'urn:li:page:d_flagship3_profile_view_base;' + Math.random().toString(36).substring(7),
            'x-li-track': '{"clientVersion":"1.13.0","mpVersion":"1.13.0","osName":"web","timezoneOffset":-3}',
            'x-restli-protocol-version': '2.0.0',
        };

        // Se temos o CSRF token, adiciona
        if (csrfToken) {
            const cleanCsrf = csrfToken.replace(/"/g, '');
            voyagerHeaders['csrf-token'] = cleanCsrf;
        }

        log(`[LINKEDIN PDF] Tentando baixar PDF para: ${username}`);

        // Tenta primeiro o endpoint Voyager que é o mais confiável
        let pdfBuffer = null;
        let lastError = null;

        // Primeiro, vamos tentar obter o URN do perfil via Voyager API
        try {
            log(`[LINKEDIN PDF] Buscando informações do perfil via Voyager...`);
            const profileResponse = await axios.get(
                `https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${username}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-19`,
                {
                    headers: voyagerHeaders,
                    timeout: 15000
                }
            );

            if (profileResponse.status === 200 && profileResponse.data) {
                log(`[LINKEDIN PDF] ✅ Perfil encontrado via Voyager API`);

                // Agora tenta baixar o PDF usando o endpoint correto
                const pdfResponse = await axios.get(
                    `https://www.linkedin.com/voyager/api/identity/profiles/${username}/profileToPdf`,
                    {
                        headers: {
                            ...voyagerHeaders,
                            'Accept': 'application/octet-stream, application/pdf',
                        },
                        responseType: 'arraybuffer',
                        timeout: 30000
                    }
                );

                if (pdfResponse.data && pdfResponse.data.byteLength > 1000) {
                    pdfBuffer = Buffer.from(pdfResponse.data);
                    log(`[LINKEDIN PDF] ✅ PDF baixado via profileToPdf: ${pdfBuffer.length} bytes`);
                }
            }
        } catch (voyagerError) {
            log(`[LINKEDIN PDF] Voyager API falhou: ${voyagerError.message}`);
            lastError = voyagerError;
        }

        // Se Voyager falhou, tenta método alternativo usando fetch direto
        if (!pdfBuffer) {
            try {
                log(`[LINKEDIN PDF] Tentando método alternativo...`);

                // Primeiro acessa a página do perfil para estabelecer cookie de sessão
                await axios.get(`https://www.linkedin.com/in/${username}/`, {
                    headers: baseHeaders,
                    timeout: 10000,
                    maxRedirects: 5
                });

                // Depois tenta o endpoint de PDF
                const pdfResponse = await axios.get(
                    `https://www.linkedin.com/in/${username}/overlay/background/getAsPdf/`,
                    {
                        headers: {
                            ...baseHeaders,
                            'Accept': 'application/octet-stream, application/pdf',
                            'Referer': `https://www.linkedin.com/in/${username}/`
                        },
                        responseType: 'arraybuffer',
                        timeout: 30000,
                        maxRedirects: 5
                    }
                );

                if (pdfResponse.data && pdfResponse.data.byteLength > 1000) {
                    pdfBuffer = Buffer.from(pdfResponse.data);
                    log(`[LINKEDIN PDF] ✅ PDF baixado via getAsPdf: ${pdfBuffer.length} bytes`);
                }
            } catch (altError) {
                log(`[LINKEDIN PDF] Método alternativo falhou: ${altError.message}`);
                lastError = altError;
            }
        }

        // Se ainda não temos PDF, retorna erro
        if (!pdfBuffer || pdfBuffer.length < 1000) {
            const errorMessage = lastError?.response?.status === 403
                ? 'Acesso negado pelo LinkedIn. O cookie pode estar expirado ou o perfil é privado.'
                : 'Não foi possível baixar o PDF do LinkedIn.';

            logError(`[LINKEDIN PDF] Falha final: ${lastError?.message || 'PDF vazio'}`);

            return res.status(401).json({
                error: errorMessage,
                code: 'PDF_DOWNLOAD_FAILED',
                details: lastError?.message
            });
        }

        // Verifica a assinatura do PDF
        const pdfSignature = pdfBuffer.slice(0, 5).toString();
        if (!pdfSignature.startsWith('%PDF')) {
            log(`[LINKEDIN PDF] ⚠️ Resposta não é PDF válido. Início: ${pdfSignature}`);

            // Log primeiros bytes para debug
            const responsePreview = pdfBuffer.slice(0, 200).toString('utf-8');
            logError(`[LINKEDIN PDF] Conteúdo recebido: ${responsePreview}`);

            // Se recebeu HTML, provavelmente é página de login
            if (responsePreview.includes('<!DOCTYPE') || responsePreview.includes('<html')) {
                return res.status(401).json({
                    error: 'Cookie de sessão expirado. Faça login novamente no LinkedIn.',
                    code: 'SESSION_EXPIRED'
                });
            }

            return res.status(500).json({
                error: 'Resposta inesperada do LinkedIn. Tente novamente.',
                code: 'INVALID_RESPONSE'
            });
        }

        // Processa o PDF
        log(`[LINKEDIN PDF] Processando PDF (${pdfBuffer.length} bytes)...`);
        const profileData = await parseLinkedInPdf(pdfBuffer);

        log('✅ LINKEDIN PDF: Extração concluída com sucesso.');
        log(`[LINKEDIN PDF] Dados: Nome=${profileData.nome}, Skills=${profileData.competencias.length}`);

        res.status(200).json({
            success: true,
            profile: profileData
        });

    } catch (error) {
        logError('❌ LINKEDIN PDF: Erro:', error.message);

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
                    error: 'Muitas requisições. Aguarde alguns minutos.',
                    code: 'RATE_LIMITED'
                });
            }
        }

        res.status(500).json({
            error: 'Erro ao buscar PDF do LinkedIn.',
            details: error.message
        });
    }
};

/**
 * Endpoint de verificação de status do cookie
 */
export const checkLinkedInCookieStatus = async (req, res) => {
    const { liAtCookie } = req.body;

    if (!liAtCookie) {
        return res.status(400).json({ valid: false, error: 'Cookie li_at não fornecido.' });
    }

    try {
        const response = await axios.get('https://www.linkedin.com/voyager/api/me', {
            headers: {
                'Cookie': `li_at=${liAtCookie}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'x-restli-protocol-version': '2.0.0'
            },
            timeout: 10000
        });

        if (response.status === 200) {
            return res.status(200).json({ valid: true, message: 'Cookie válido.' });
        }
    } catch (error) {
        if (error.response?.status === 401 || error.response?.status === 403) {
            return res.status(200).json({ valid: false, error: 'Cookie expirado.' });
        }
    }

    res.status(200).json({ valid: false, error: 'Não foi possível verificar.' });
};
