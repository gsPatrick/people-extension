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
        console.error(`[PDF-DEBUG] Trying to require('${moduleName}')...`);
        const lib = require(moduleName);
        console.error(`[PDF-DEBUG] Loaded '${moduleName}'. Type: ${typeof lib}`);

        if (typeof lib === 'function') return lib;
        if (lib && typeof lib.default === 'function') return lib.default;

        console.error(`[PDF-DEBUG] '${moduleName}' is not a function. Keys: ${Object.keys(lib || {})}`);
        return lib; // Retorna mesmo se não for função, para debug
    } catch (e) {
        console.error(`[PDF-DEBUG] Failed to load '${moduleName}': ${e.message}`);
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
        console.error('⚠️ [WARN] Using pdf.PDFParse function from object export.');
        pdf = pdf.PDFParse;
    } else if (pdf.default && typeof pdf.default === 'function') {
        pdf = pdf.default;
    }
}

console.error(`[PDF-DEBUG] FINAL PDF OBJECT TYPE: ${typeof pdf}`);
// ==================================================================================


// Função auxiliar para limpar texto
const cleanText = (text) => text && text.replace ? text.replace(/\s+/g, ' ').trim() : '';

/**
 * Processa um buffer de PDF e extrai informações estruturadas do perfil.
 */
export const extractProfileFromPdf = async (req, res) => {
    console.error('--- CONTROLLER PDF: Recebido request ---');

    if (!req.file || !req.file.buffer) {
        console.error('❌ ERRO: Nenhum arquivo no request.');
        return res.status(400).json({ error: 'Nenhum arquivo PDF foi enviado.' });
    }

    // Validação final da biblioteca antes de usar
    if (typeof pdf !== 'function') {
        const keys = pdf ? Object.keys(pdf).join(', ') : 'null';
        const msg = `CRITICAL: pdf-parse lib is not a function. It is: ${typeof pdf}. Keys: [${keys}]. Check server logs.`;
        console.error(`❌ ${msg}`);
        return res.status(500).json({ error: msg });
    }

    try {
        const pdfBuffer = req.file.buffer;
        console.error(`[PDF-DEBUG] Buffer size: ${pdfBuffer.length}`);

        // CHAMADA ROBUSTA: Tenta chamar como função, se falhar, tenta com new
        let data;
        try {
            data = await pdf(pdfBuffer);
        } catch (callError) {
            if (callError.toString().includes("Class constructors cannot be invoked without 'new'")) {
                console.error('[PDF-DEBUG] Detected class constructor. Retrying with "new"...');
                // Se for uma classe, pode ser que precise de new. 
                // Mas precisamos saber se retorna promise ou instância.
                // Tentativa 1: new pdf(buffer) (se for promessa/thenable)
                try {
                    const instance = new pdf(pdfBuffer);
                    console.error('[PDF-DEBUG] Instance created with "new".');

                    // INTROSPECTION
                    const keys = Object.keys(instance);
                    const protoKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(instance));
                    console.error(`[PDF-DEBUG] Instance Keys: [${keys.join(', ')}]`);
                    console.error(`[PDF-DEBUG] Proto Keys: [${protoKeys.join(', ')}]`);

                    // INTROSPECTION REVEALED: getText() exists!
                    if (typeof instance.getText === 'function') {
                        console.error('[PDF-DEBUG] Calling instance.getText()...');
                        const text = await instance.getText();
                        console.error(`[PDF-DEBUG] getText() returned type: ${typeof text}`);

                        if (typeof text === 'string') {
                            data = { text };
                        } else if (text && text.text) {
                            data = text;
                        } else {
                            // Fallback: maybe load() is needed first?
                            console.error('[PDF-DEBUG] getText() result weird. Trying load()...');
                            await instance.load();
                            data = { text: await instance.getText() };
                        }
                    } else if (typeof instance.load === 'function') {
                        // Case: load() might be main entry
                        await instance.load();
                        data = instance; // Hope text is attached
                    } else {
                        throw new Error(`Instance created but don't know how to extract text. Keys: ${Object.keys(instance)}`);
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

        console.error('[PDF-DEBUG] Text extracted length:', data.text.length);
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
            if (line.startsWith('Página')) { currentSection = ''; continue; }

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