// ARQUIVO: src/controllers/pdf.controller.js

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { log, error as logError } from '../utils/logger.service.js';

// ==================================================================================
// LOADING PDF-PARSE LIBRARY SAFELY
// ==================================================================================
let pdf;

// Função auxiliar para tentar carregar e validar
function tryLoadPdf(moduleName) {
    try {
        const lib = require(moduleName);
        if (typeof lib === 'function') return lib;
        if (lib && typeof lib.default === 'function') return lib.default;
        return lib;
    } catch (e) {
        return null;
    }
}

// Tenta carregar de várias formas
pdf = tryLoadPdf('pdf-parse/index');
if (!pdf) pdf = tryLoadPdf('pdf-parse');

// Se não funcionou, tenta o caminho interno
if (!pdf || (typeof pdf !== 'function' && !pdf.PDFParse)) {
    const internal = tryLoadPdf('pdf-parse/lib/pdf-parse.js');
    if (internal) pdf = internal;
}

// Adaptação para quando exporta um objeto com PDFParse
if (typeof pdf === 'object' && pdf !== null) {
    if (typeof pdf.PDFParse === 'function') {
        pdf = pdf.PDFParse;
    } else if (pdf.default && typeof pdf.default === 'function') {
        pdf = pdf.default;
    }
}
// ==================================================================================

// --- REGEX PATTERNS (PIPELINE DETERMINÍSTICO) ---
const REGEX_DATE_PT = /(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro) de (\d{4})/i;
const REGEX_DATE_EN = /(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})/i;
const REGEX_PRESENT_PT = /(o momento|presente|atual)/i;
const REGEX_PRESENT_EN = /(present|current)/i;

const MONTH_MAP = {
    'janeiro': '01', 'january': '01',
    'fevereiro': '02', 'february': '02',
    'março': '03', 'march': '03',
    'abril': '04', 'april': '04',
    'maio': '05', 'may': '05',
    'junho': '06', 'june': '06',
    'julho': '07', 'july': '07',
    'agosto': '08', 'august': '08',
    'setembro': '09', 'september': '09',
    'outubro': '10', 'october': '10',
    'novembro': '11', 'november': '11',
    'dezembro': '12', 'december': '12'
};

// --- PIPELINE FUNCTIONS ---

const normalizeDate = (dateStr) => {
    if (!dateStr) return null;
    if (REGEX_PRESENT_PT.test(dateStr) || REGEX_PRESENT_EN.test(dateStr)) return null; // "Present" é null (fim)

    const ptMatch = dateStr.match(REGEX_DATE_PT);
    if (ptMatch) {
        const month = MONTH_MAP[ptMatch[1].toLowerCase()];
        return `${ptMatch[2]}-${month}`;
    }

    const enMatch = dateStr.match(REGEX_DATE_EN);
    if (enMatch) {
        const month = MONTH_MAP[enMatch[1].toLowerCase()];
        return `${enMatch[2]}-${month}`;
    }

    return null;
};

const sanitizeText = (text) => {
    if (!text) return '';
    return text
        .replace(/Page \d+ of \d+/g, '') // Remove "Page 1 of 4"
        .replace(/-- \d+ of \d+ --/g, '') // Remove "-- 1 of 4 --"
        .replace(/-- Page \d+ of \d+ --/g, '') // Remove variant
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0) // Remove empty lines
        .join('\n');
};

const splitSections = (text) => {
    const lines = text.split('\n');
    const sections = {
        header: [],
        resumo: [],
        experiencia: [],
        formacao: [],
        skills: []
    };

    let current = 'header';

    for (const line of lines) {
        const lower = line.toLowerCase();
        if (lower === 'resumo' || lower === 'summary') { current = 'resumo'; continue; }
        if (lower === 'experiência' || lower === 'experience') { current = 'experiencia'; continue; }
        if (lower === 'formação acadêmica' || lower === 'education') { current = 'formacao'; continue; }
        if (lower === 'principais competências' || lower === 'top skills' || lower === 'skills') { current = 'skills'; continue; }
        if (lower === 'idiomas' || lower === 'languages') { current = 'ignore'; continue; }
        if (lower === 'certifications' || lower === 'certificações') { current = 'ignore'; continue; }

        if (current !== 'ignore') sections[current].push(line);
    }
    return sections;
};

const parseExperiences = (lines) => {
    const experiences = [];
    let currentExp = null;

    // Helper: Detecta linha de data (ex: "outubro de 2025 - Present (3 meses)")
    const isDateLine = (line) => {
        return (REGEX_DATE_PT.test(line) || REGEX_DATE_EN.test(line)) && (line.includes('-') || line.toLowerCase().includes('·'));
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Heurística de novo bloco: Data encontrada na linha i+1 ou i+2
        // Mas a estrutura do LinkedIn PDF é variável.
        // Padrão comum: Cargo \n Empresa \n Data \n Local

        // Vamos tentar detectar o padrão de data e "olhar para trás"
        if (isDateLine(line)) {
            // Encontrou data. As linhas anteriores são Cargo e Empresa.
            // Se já tínhamos uma experiência aberta, fechamos sua descrição.

            let cargo = '';
            let empresa = '';
            let startIndex = i - 1;

            // Tenta pegar empresa (linha anterior)
            if (startIndex >= 0 && !isDateLine(lines[startIndex])) {
                empresa = lines[startIndex];
                startIndex--;
            }
            // Tenta pegar cargo (linha anterior a empresa)
            if (startIndex >= 0 && !isDateLine(lines[startIndex])) {
                cargo = lines[startIndex];
            }

            // Se não achou cargo/empresa, talvez seja "Cargo at Empresa" numa linha só?
            // No PDF do LinkedIn vem quebrado.

            // Extrair datas
            const parts = line.split(/-|·/).map(s => s.trim());
            const inicioRaw = parts[0];
            const fimRaw = parts[1] || 'Present'; // Se não tiver fim claro

            const novaExp = {
                empresa: empresa || 'Empresa desconhecida',
                cargo: cargo || 'Cargo desconhecido',
                localizacao: null,
                inicio: normalizeDate(inicioRaw),
                fim: normalizeDate(fimRaw),
                descricao: ''
            };

            // Verifica linha seguinte para localização (comum "Sao Paulo, Brazil")
            if (i + 1 < lines.length && !isDateLine(lines[i + 1])) {
                // Heurística simples: se não for texto longo, é local
                if (lines[i + 1].length < 50) {
                    novaExp.localizacao = lines[i + 1];
                    i++;
                }
            }

            experiences.push(novaExp);
            currentExp = novaExp;
        } else if (currentExp) {
            // Append description
            currentExp.descricao += (currentExp.descricao ? '\n' : '') + line;
        }
    }
    return experiences;
};

const parseEducation = (lines) => {
    const education = [];
    // Padrão: Instituição \n Curso \n Data

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Heurística: linha com data é o fim do bloco
        if (line.match(/\d{4}\s*-\s*\d{4}/)) { // "2014 - 2022"
            const parts = line.match(/(\d{4})\s*-\s*(\d{4})/);
            const instituicao = lines[i - 2] || lines[i - 1] || 'Instituição Desconhecida'; // Simplificado
            const curso = lines[i - 1] !== instituicao ? lines[i - 1] : '';

            education.push({
                instituicao: instituicao,
                curso: curso,
                inicio: parts ? `${parts[1]}-01` : null,
                fim: parts ? `${parts[2]}-12` : null
            });
        }
    }
    return education;
};


/**
 * Processa um buffer de PDF e extrai informações estruturadas do perfil.
 */
export const extractProfileFromPdf = async (req, res) => {
    if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'Nenhum arquivo PDF foi enviado.' });
    }

    // Validação final da biblioteca antes de usar
    if (typeof pdf !== 'function' && (!pdf || typeof pdf.PDFParse !== 'function')) {
        const msg = `CRITICAL: pdf-parse lib not initialized correctly. Check logs.`;
        logError(msg);
        return res.status(500).json({ error: msg });
    }

    try {
        const pdfBuffer = req.file.buffer;

        // CONVERSÃO DE TIPO: A lib exige Uint8Array puro, não Buffer
        const pdfData = new Uint8Array(pdfBuffer);

        // CHAMADA ROBUSTA: Tenta chamar como função, se falhar, tenta com new
        let data;
        try {
            // Tenta chamada direta primeiro
            data = await pdf(pdfData);
        } catch (callError) {
            // Se falhar, tenta instanciar como classe (comum em algumas versões/builds)
            if (callError.toString().includes("Class constructors") || callError.toString().includes("is not a function")) {
                try {
                    const instance = new pdf(pdfData);

                    // Verifica se tem método getText (padrão em versões orientadas a objeto)
                    if (typeof instance.getText === 'function') {
                        data = await instance.getText();
                    } else if (instance && typeof instance.then === 'function') {
                        data = await instance;
                    } else if (instance && instance.text) {
                        data = instance;
                    } else {
                        // Tenta load() como fallback
                        if (typeof instance.load === 'function') await instance.load();
                        data = instance;
                    }
                } catch (newError) {
                    throw new Error(`Failed with new: ${newError.message}`);
                }
            } else {
                throw callError;
            }
        }

        // --- PIPELINE DETERMINÍSTICO ---
        // 1. Sanitize
        // Normaliza retorno se necessário
        let rawText = '';
        if (typeof data === 'string') rawText = data;
        else if (data && data.text) rawText = data.text;

        const cleanBody = sanitizeText(rawText);

        // 2. Split Sections
        const sections = splitSections(cleanBody);

        // 3. Parse Entities
        // Header parsing (Nome, Titulo, Local)
        // Linha 0: Nome (se não for "Page...")
        // Linha 1: Titulo
        // Linha 2: Local
        // Isso é frágil, mas o determinístico exige assumir estrutura.
        const headerLines = sections.header;

        const perfil = {
            nome: headerLines[0] || null,
            titulo: headerLines[1] || null,
            linkedin: null, // Difícil pegar do corpo se não estiver explícito
            localizacao: null
        };
        // Tenta achar linkedin no header
        headerLines.forEach(l => {
            if (l.includes('linkedin.com')) perfil.linkedin = l;
            // Localização heuristic: não tem email, não tem linkedin, não é titulo longo
            if (!perfil.localizacao && !l.includes('@') && !l.includes('http') && l.length < 50 && l !== perfil.nome && l !== perfil.titulo) {
                // perfil.localizacao = l; // Arriscado, deixa null se não tiver certeza
            }
        });

        // 4. Build Canonical Profile
        const canonicalProfile = {
            perfil: perfil,
            resumo: sections.resumo.join('\n'),
            experiencias: parseExperiences(sections.experiencia),
            formacao: parseEducation(sections.formacao),
            skills: sections.skills.flatMap(l => l.split(/·|,/).map(s => s.trim()).filter(Boolean))
        };

        log('✅ CONTROLLER PDF: Extração DETERMINÍSTICA concluída com sucesso.');
        res.status(200).json(canonicalProfile);

    } catch (error) {
        logError('❌ CONTROLLER PDF: Erro ao processar o PDF:', error.message);
        console.error(error);
        res.status(500).json({ error: `Erro interno: ${error.message}` });
    }
};