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
pdf = tryLoadPdf('pdf-parse/index'); // Tenta o index explicitamente
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


// Função auxiliar para limpar texto
const cleanText = (text) => text && text.replace ? text.replace(/\s+/g, ' ').trim() : '';

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
                        // Normaliza retorno se necessário
                        if (typeof data === 'string') data = { text: data };
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

        if (!data || !data.text) {
            throw new Error('PDF parsed but returned no text/data.');
        }

        const lines = data.text.split('\n').filter(line => line.trim() !== '');

        // --- Lógica de Extração ---
        const profileData = {
            nome: lines[0] ? cleanText(lines[0]) : null,
            headline: lines[1] ? cleanText(lines[1]) : null,
            resumo: '',
            experiencias: [],
            formacao: [],
            competencias: [],
            textoCompleto: data.text
        };

        let currentSection = '';

        for (let i = 2; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            if (line === 'Resumo') { currentSection = 'resumo'; continue; }
            if (line === 'Experiência') { currentSection = 'experiencia'; continue; }
            if (line === 'Formação acadêmica') { currentSection = 'formacao'; continue; }
            if (line === 'Principais competências') { currentSection = 'competencias'; continue; }
            if (line.startsWith('Page ') || line.startsWith('-- Page') || line.includes(' of ')) { currentSection = ''; continue; }

            switch (currentSection) {
                case 'resumo':
                    profileData.resumo += ` ${line}`;
                    break;
                case 'experiencia':
                    profileData.experiencias.push({
                        cargo: line,
                        empresa: lines[i + 1] || '',
                        periodo: lines[i + 2] || ''
                    });
                    i += 2;
                    break;
                case 'formacao':
                    profileData.formacao.push({
                        instituicao: line,
                        curso: lines[i + 1] || '',
                        periodo: lines[i + 2] || ''
                    });
                    i += 2;
                    break;
                case 'competencias':
                    profileData.competencias = line.split(/·|,/g).map(s => s.trim()).filter(Boolean);
                    break;
            }
        }

        profileData.resumo = cleanText(profileData.resumo);

        log('✅ CONTROLLER PDF: Extração do PDF concluída com sucesso.');
        res.status(200).json(profileData);

    } catch (error) {
        logError('❌ CONTROLLER PDF: Erro ao processar o PDF:', error.message);
        console.error(error); // Garante que o stack trace saia
        res.status(500).json({ error: `Erro interno: ${error.message}` });
    }
};