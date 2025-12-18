export const normalizeDate = (dateText) => {
    if (!dateText) return null;

    // "Presente" ou "Present" -> null (significa atual)
    if (/(present|presente|atual|o momento)/i.test(dateText)) return null;

    const MONTHS = {
        'janeiro': '01', 'january': '01', 'jan': '01',
        'fevereiro': '02', 'february': '02', 'feb': '02',
        'março': '03', 'march': '03', 'mar': '03',
        'abril': '04', 'april': '04', 'apr': '04',
        'maio': '05', 'may': '05',
        'junho': '06', 'june': '06', 'jun': '06',
        'julho': '07', 'july': '07', 'jul': '07',
        'agosto': '08', 'august': '08', 'aug': '08',
        'setembro': '09', 'september': '09', 'sep': '09',
        'outubro': '10', 'october': '10', 'oct': '10',
        'novembro': '11', 'november': '11', 'nov': '11',
        'dezembro': '12', 'december': '12', 'dec': '12'
    };

    // Regex para "Mês de Ano" ou "Month Year"
    const match = dateText.match(/([a-zA-Zç]+)\s+(?:de\s+)?(\d{4})/i);

    if (match) {
        const monthName = match[1].toLowerCase();
        const year = match[2];
        const monthVal = MONTHS[monthName];
        if (monthVal) {
            return `${year}-${monthVal}`; // YYYY-MM
        }
    }

    return null;
};

export const sanitizeText = (text) => {
    if (!text) return '';
    return text
        .replace(/Page \d+ of \d+/gi, '')
        .replace(/-- \d+ of \d+ --/gi, '')
        .replace(/-- Page \d+ of \d+ --/gi, '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line) // Remove linhas vazias
        .join('\n'); // Texto limpo contínuo
};

export const splitSections = (text) => {
    const lines = text.split('\n');
    const sections = {
        resumo: '',
        experiencia: [],
        formacao: [],
        skills: []
    };

    let current = null; // 'resumo', 'experiencia', 'formacao', 'skills'

    for (const line of lines) {
        const lower = line.toLowerCase();

        // Âncoras literais
        if (lower === 'resumo' || lower === 'summary') {
            current = 'resumo';
            continue;
        }
        if (lower === 'experiência' || lower === 'experience') {
            current = 'experiencia';
            continue;
        }
        if (lower === 'formação acadêmica' || lower === 'education' || lower === 'formação') {
            current = 'formacao';
            continue;
        }
        if (lower === 'principais competências' || lower === 'competências' || lower === 'skills' || lower === 'top skills') {
            current = 'skills';
            continue;
        }
        // Ignorar outras seções não mapeadas
        if (lower === 'idiomas' || lower === 'certificações' || lower === 'honors & awards') {
            current = null;
            continue;
        }

        if (current === 'resumo') {
            sections.resumo += (sections.resumo ? '\n' : '') + line;
        } else if (current === 'experiencia') {
            sections.experiencia.push(line);
        } else if (current === 'formacao') {
            sections.formacao.push(line);
        } else if (current === 'skills') {
            sections.skills.push(line);
        }
    }

    // Join arrays back to string for parsing logic expecting blocks? 
    // No, parseExperiences expects lines array behavior effectively, specifically "Experience Text". 
    // The previous implementation used array push, let's keep array for parsing functions or join.
    // The requirement says splitSections returns strings probably for block processing.
    // Let's refine based on "parseExperiences(experienceText: string)". So let's join logic.

    return {
        resumo: sections.resumo,
        experiencia: sections.experiencia.join('\n'),
        formacao: sections.formacao.join('\n'),
        skills: sections.skills.join('\n')
    };
};

export const parseExperiences = (experienceText) => {
    if (!experienceText) return [];

    const lines = experienceText.split('\n');
    const experiences = [];
    let currentExp = null;

    // Regex para detectar linha de data/duração
    // Padrão: "outubro de 2023 - Present (1 ano 4 meses)" ou "Jan 2020 - Dec 2021 · 2 yrs"
    const dateLineRegex = /((?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\s*(?:de\s*)?\d{4}|presente|present|atual)\s*[-–]\s*((?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\s*(?:de\s*)?\d{4}|presente|present|atual)/i;

    // Buffer para armazenar linhas que podem ser Cargo/Empresa antes da data
    let buffer = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (dateLineRegex.test(line)) {
            // Encontrou data -> Consolidar o bloco anterior se existir
            // As linhas imediatamente ANTES desta data são Cargo e Empresa.
            // Geralmente: 
            // 1. Cargo
            // 2. Empresa
            // 3. Data (Atual)
            // OU
            // 1. Empresa
            // 2. Cargo
            // 3. Data

            // Heurística de stack:
            // buffer[buffer.length-1] = Empresa (imediatamente antes da data?) 
            // buffer[buffer.length-2] = Cargo
            // Essa estrutura varia muito no PDF do LinkedIn. 
            // Vamos assumir: buffer[last] = Empresa, buffer[last-1] = Cargo.

            let cargo = "Cargo Desconhecido";
            let empresa = "Empresa Desconhecida";

            // Se temos algo no buffer, usaremos as últimas linhas como Cargo/Empresa.
            // O resto do buffer pertence à descrição da experiência ANTERIOR (se houver).

            if (buffer.length >= 2) {
                empresa = buffer.pop();
                cargo = buffer.pop();

                // O que sobrou no buffer era descrição da anterior
                if (currentExp && buffer.length > 0) {
                    currentExp.descricao += (currentExp.descricao ? '\n' : '') + buffer.join('\n');
                }
            } else if (buffer.length === 1) {
                // Só tem uma linha, ou é cargo ou empresa. LinkedIn costuma por Cargo primeiro.
                cargo = buffer.pop();
            }

            // Inicia nova experiência
            // Parse das datas
            const dates = line.match(/((?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\s*(?:de\s*)?\d{4}|presente|present|atual)/gi);
            const startRaw = dates ? dates[0] : null;
            const endRaw = dates && dates.length > 1 ? dates[1] : null;

            currentExp = {
                empresa: empresa,
                cargo: cargo,
                localizacao: null, // Será preenchido se próxima linha não for descrição
                inicio: normalizeDate(startRaw),
                fim: normalizeDate(endRaw),
                descricao: ""
            };

            experiences.push(currentExp);
            buffer = []; // Limpa buffer após processar cabeçalho

            // Verifica localização na próxima linha
            if (i + 1 < lines.length) {
                const nextLine = lines[i + 1];
                // Heurística simples para local: curto e contem virgula ou pais
                if (nextLine.length < 50 && !dateLineRegex.test(nextLine)) {
                    currentExp.localizacao = nextLine;
                    i++; // Pula linha de local
                }
            }
        } else {
            // Acumula no buffer. Se tivermos uma experiência ativa, 
            // essas linhas podem ser descrição OU cabeçalho da próxima.
            // Só saberemos quando encontrarmos a PRÓXIMA data.
            // Por enquanto guardamos no buffer.
            // Se acabar o loop, o buffer todo vira descrição da última.
            buffer.push(line);
        }
    }

    // Finalização: Drenar buffer restante para a última experiência
    if (currentExp && buffer.length > 0) {
        currentExp.descricao += (currentExp.descricao ? '\n' : '') + buffer.join('\n');
    }

    return experiences;
};

const parseEducation = (eduText) => {
    if (!eduText) return [];

    // Simplificado pois não foi detalhado no requisito "parseExperiences" mas é necessário para o Canonical
    const lines = eduText.split('\n');
    const education = [];

    // Agrupamento simples por blocos de 3 linhas (Instituição, Curso, Data) ou Regex de ano
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Heurística: linha com ano "2014 - 2022"
        if (/\d{4}.*\d{4}/.test(line)) {
            // Se achou data, linhas anteriores são curso e instituição
            const instituicao = lines[i - 1] || "Instituição";
            const curso = lines[i - 2] || ""; // Layout pode variar

            // Extrair anos
            const years = line.match(/(\d{4})/g);
            education.push({
                instituicao: instituicao,
                curso: curso,
                inicio: years && years[0] ? `${years[0]}-01` : null,
                fim: years && years[1] ? `${years[1]}-12` : null
            });
        }
    }
    return education;
};

export const buildCanonicalProfile = (rawPdfText) => {
    const cleanText = sanitizeText(rawPdfText);
    const sections = splitSections(cleanText);

    // Tentar extrair nome/titulo do inicio do texto bruto (antes das seções)
    // O sanitizeText removeu duplicatas, mas o splitSections separou baseado em keywords.
    // O que vem antes de "Resumo" é o perfil.
    const allLines = cleanText.split('\n');
    const resumoIndex = allLines.findIndex(l => l.toLowerCase() === 'resumo' || l.toLowerCase() === 'summary');

    const headerLines = resumoIndex > 0 ? allLines.slice(0, resumoIndex) : allLines.slice(0, 5);

    const perfil = {
        nome: headerLines[0] || null,
        titulo: headerLines[1] || null,
        linkedin: headerLines.find(l => l.includes('linkedin.com')) || null,
        localizacao: headerLines.find(l => !l.includes('linkedin') && !l.includes('@') && l.length < 50 && l !== headerLines[0] && l !== headerLines[1]) || null
    };

    const experiences = parseExperiences(sections.experiencia);
    const formacao = parseEducation(sections.formacao); // Necessário implementar básico mesmo sem requisito explícito detalhado, para cumprir o schema

    // Skills: string única para array
    const skills = sections.skills
        ? sections.skills.split(/[,·\n]/).map(s => s.trim()).filter(s => s.length > 2)
        : [];

    return {
        perfil,
        resumo: sections.resumo,
        experiencias: experiences,
        formacao: formacao,
        skills: [...new Set(skills)] // Remove duplicatas
    };
};
