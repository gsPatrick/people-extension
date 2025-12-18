// ARQUIVO: src/controllers/pdf.controller.js

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
// pdf-parse pode exportar de formas diferentes
const pdf = typeof pdfParse === 'function' ? pdfParse : (pdfParse.default || pdfParse);

import { log, error as logError } from '../utils/logger.service.js';

// Função auxiliar para limpar texto
const cleanText = (text) => text.replace(/\s+/g, ' ').trim();

/**
 * Processa um buffer de PDF e extrai informações estruturadas do perfil.
 */
export const extractProfileFromPdf = async (req, res) => {
    if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'Nenhum arquivo PDF foi enviado.' });
    }

    log('--- CONTROLLER PDF: Recebido arquivo PDF para extração. ---');

    try {
        const pdfBuffer = req.file.buffer;
        const data = await pdf(pdfBuffer);
        const lines = data.text.split('\n').filter(line => line.trim() !== '');

        // --- Lógica de Extração por Blocos (Mais Robusta que Regex) ---
        const profileData = {
            nome: lines[0] ? cleanText(lines[0]) : null,
            headline: lines[1] ? cleanText(lines[1]) : null,
            resumo: '',
            experiencias: [],
            formacao: [],
            competencias: [],
            textoCompleto: data.text // Opcional, para debug
        };

        let currentSection = ''; // Controla a seção atual: 'resumo', 'experiencia', etc.
        let tempExperience = null;
        let tempEducation = null;

        for (let i = 2; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Detecta o início de uma nova seção
            if (line === 'Resumo') { currentSection = 'resumo'; continue; }
            if (line === 'Experiência') { currentSection = 'experiencia'; continue; }
            if (line === 'Formação acadêmica') { currentSection = 'formacao'; continue; }
            if (line === 'Principais competências') { currentSection = 'competencias'; continue; }
            if (line.startsWith('Página')) { currentSection = ''; continue; } // Ignora rodapés

            // Processa a linha de acordo com a seção atual
            switch (currentSection) {
                case 'resumo':
                    profileData.resumo += ` ${line}`;
                    break;

                case 'experiencia':
                    // A lógica aqui assume um padrão. Pode precisar de ajustes.
                    // Título do Cargo
                    profileData.experiencias.push({
                        cargo: line,
                        empresa: lines[i + 1] || '',
                        periodo: lines[i + 2] || ''
                    });
                    i += 2; // Pula as próximas 2 linhas que já processamos
                    break;

                case 'formacao':
                    profileData.formacao.push({
                        instituicao: line,
                        curso: lines[i + 1] || '',
                        periodo: lines[i + 2] || ''
                    });
                    i += 2; // Pula as próximas 2 linhas
                    break;

                case 'competencias':
                    // As competências geralmente vêm em uma linha, separadas por "·" ou vírgulas
                    profileData.competencias = line.split(/·|,/g).map(s => s.trim()).filter(Boolean);
                    break;
            }
        }

        profileData.resumo = cleanText(profileData.resumo);
        log('✅ CONTROLLER PDF: Extração do PDF concluída com sucesso.');
        res.status(200).json(profileData);

    } catch (error) {
        logError('❌ CONTROLLER PDF: Erro ao processar o PDF:', error.message);
        res.status(500).json({ error: 'Erro interno ao extrair dados do PDF.' });
    }
};