// ARQUIVO: src/controllers/pdf.controller.js

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { log, error as logError } from '../utils/logger.service.js';
import { buildCanonicalProfile } from '../utils/profileNormalizer.js';

// ==================================================================================
// LOADING PDF-PARSE LIBRARY SAFELY
// ==================================================================================
let pdf;

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

pdf = tryLoadPdf('pdf-parse/index');
if (!pdf) pdf = tryLoadPdf('pdf-parse');

if (!pdf || (typeof pdf !== 'function' && !pdf.PDFParse)) {
    const internal = tryLoadPdf('pdf-parse/lib/pdf-parse.js');
    if (internal) pdf = internal;
}

if (typeof pdf === 'object' && pdf !== null) {
    if (typeof pdf.PDFParse === 'function') {
        pdf = pdf.PDFParse;
    } else if (pdf.default && typeof pdf.default === 'function') {
        pdf = pdf.default;
    }
}
// ==================================================================================


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

        // --- CUSTOM RENDER FUNCTION (COLUNA DIREITA PRIMEIRO) ---
        // LinkedIn PDF tem 2 colunas: Sidebar (Esq) e Main (Dir).
        // Queremos priorizar o Main para pegar Nome/Titulo corretamente.
        const render_page = async (pageData) => {
            const render_options = {
                normalizeWhitespace: false,
                disableCombineTextItems: false
            };

            const textContent = await pageData.getTextContent(render_options);

            // Separa itens por coluna (Heurística: X < 180 é sidebar)
            const sidebar = [];
            const main = [];

            for (const item of textContent.items) {
                // item.transform = [scaleX, skewY, skewX, scaleY, x, y]
                const x = item.transform[4];
                const text = item.str;

                if (!text || !text.trim()) continue;

                // Threshold 150-200 funciona bem para A4 padrão do LinkedIn
                // Main content geralmente começa > 200
                if (x < 180) {
                    sidebar.push(text);
                } else {
                    main.push(text);
                }
            }

            // Retorna texto com MAIN primeiro, depois SIDEBAR
            // Isola completamente o conteúdo principal do ruído lateral
            return main.join('\n') + '\n\n' + sidebar.join('\n');
        };

        const options = {
            pagerender: render_page
        };

        let data;
        let pusedoInstance = false;

        try {
            // Tenta chamada direta primeiro
            data = await pdf(pdfData, options);
        } catch (callError) {
            // Se falhar, tenta instanciar como classe (comum em algumas versões/builds)
            if (callError.toString().includes("Class constructors") || callError.toString().includes("is not a function")) {
                try {
                    // Tenta passar options no construtor
                    const instance = new pdf(pdfData, options);
                    pusedoInstance = true;

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
        let rawText = '';
        if (typeof data === 'string') rawText = data;
        else if (data && data.text) rawText = data.text;

        // Se a instância foi usada e o render_page não foi chamado (pq a lib ignorou options no new),
        // teremos o texto linear original. 
        // Não há muito o que fazer sem wrapper, mas a maioria das versões suporta opções.

        // Passa para o normalizador
        const canonicalProfile = buildCanonicalProfile(rawText);

        log('✅ CONTROLLER PDF: Extração DETERMINÍSTICA (via profileNormalizer + ColumnAware) concluída.');
        res.status(200).json(canonicalProfile);

    } catch (error) {
        logError('❌ CONTROLLER PDF: Erro ao processar o PDF:', error.message);
        console.error(error);
        res.status(500).json({ error: `Erro interno: ${error.message}` });
    }
};