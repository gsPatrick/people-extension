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
        // FIX: Preserva uma linha vazia entre blocos para manter semântica
        .filter((line, i, arr) => line || (arr[i - 1] && arr[i - 1].trim().length > 0))
        .join('\n');
};

export const splitSections = (text) => {
    const lines = text.split('\n');
    const sections = {
        resumo: '',
        experiencia: [],
        formacao: [],
        skills: []
    };

    let current = null;

    for (const line of lines) {
        const lower = line.toLowerCase();

        // Âncoras literais estritas
        if (lower === 'resumo' || lower === 'summary') { current = 'resumo'; continue; }
        if (lower === 'experiência' || lower === 'experience') { current = 'experiencia'; continue; }
        if (lower === 'formação acadêmica' || lower === 'education' || lower === 'formação') { current = 'formacao'; continue; }
        if (lower === 'principais competências' || lower === 'competências' || lower === 'skills' || lower === 'top skills') { current = 'skills'; continue; }

        // Ignora outras seções irrelevantes
        if (lower === 'idiomas' || lower === 'languages' || lower === 'certificações' || lower === 'honors & awards' || lower === 'projects') {
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
    const dateLineRegex = /((?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\s*(?:de\s*)?\d{4}|presente|present|atual)\s*[-–]\s*((?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\s*(?:de\s*)?\d{4}|presente|present|atual)/i;

    let buffer = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (dateLineRegex.test(line)) {
            // FIX: Ordem correta de pop do stack
            // LinkedIn PDF Padrão: 
            // 1. Nome Empresa
            // 2. Título Cargo
            // 3. Data

            // Buffer = [Empresa, Cargo]
            // Pop() -> Cargo
            // Pop() -> Empresa

            let cargo = "Cargo Indefinido";
            let empresa = "Empresa Indefinida";

            if (buffer.length >= 2) {
                // Último item inserido foi o Cargo (linha 2)
                cargo = buffer.pop();
                // Penúltimo item foi Empresa (linha 1)
                empresa = buffer.pop();

                // O resto era descrição da anterior
                if (currentExp && buffer.length > 0) {
                    currentExp.descricao += (currentExp.descricao ? '\n' : '') + buffer.join('\n');
                }
            } else if (buffer.length === 1) {
                // Muito ambíguo, mas geralmente a linha única acima da data é o cargo ou empresa
                // No contexto do LinkedIn, geralmente vem Empresa primeiro se misturado.
                // Mas vamos jogar seguro:
                empresa = buffer.pop();
            }

            const dates = line.match(/((?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\s*(?:de\s*)?\d{4}|presente|present|atual)/gi);
            const startRaw = dates ? dates[0] : null;
            const endRaw = dates && dates.length > 1 ? dates[1] : null;

            currentExp = {
                empresa: empresa,
                cargo: cargo,
                localizacao: null,
                inicio: normalizeDate(startRaw),
                fim: normalizeDate(endRaw),
                descricao: ""
            };

            experiences.push(currentExp);
            buffer = [];

            // FIX: Validação estrita de localização
            if (i + 1 < lines.length) {
                const nextLine = lines[i + 1];
                // Só aceita se tiver vírgula (cidade, pais) ou palavras chave explicitas
                if (nextLine.includes(',') || /brasil|brazil|united states|eua|remoto|remote|híbrido|hybrid/i.test(nextLine)) {
                    // E que não seja outra data
                    if (!dateLineRegex.test(nextLine)) {
                        currentExp.localizacao = nextLine;
                        i++;
                    }
                }
            }
        } else {
            // Só adiciona linhas não vazias ao buffer
            if (line.trim()) buffer.push(line);
        }
    }

    // Drain buffer
    if (currentExp && buffer.length > 0) {
        currentExp.descricao += (currentExp.descricao ? '\n' : '') + buffer.join('\n');
    }

    return experiences;
};

const parseEducation = (eduText) => {
    if (!eduText) return [];

    const lines = eduText.split('\n').filter(l => l.trim());
    const education = [];

    // Tentativa robusta de agrupar por blocos
    // Procurar linhas de data e assumir as linhas imediatamente acima

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match ano-ano: 2014 - 2022
        const dateMatch = line.match(/(\d{4})\s*[-–]\s*(\d{4})/);
        if (dateMatch) {
            // FIX: Não assumir cegamente i-1 e i-2. Verificar se existem.
            const curso = i > 0 ? lines[i - 1] : "Curso Indefinido";
            const instituicao = i > 1 ? lines[i - 2] : (i > 0 ? "Instituição (Verificar)" : "Instituição Indefinida");

            // Refinamento: Se array tem apenas 2 linhas antes da data, ok.
            // Se tem mais, pode ser que 'instituicao' pegou lixo. 
            // Mas em 'deterministic logic' sem IA, stack traces fixos são o padrão.
            // Se i-1 for igual a instituicao (duplicado), limpa.
            const cursoFinal = curso !== instituicao ? curso : "";

            education.push({
                instituicao: instituicao,
                curso: cursoFinal,
                inicio: `${dateMatch[1]}-01`,
                fim: `${dateMatch[2]}-12`
            });
        }
    }
    return education;
};

export const buildCanonicalProfile = (rawPdfText) => {
    const cleanBody = sanitizeText(rawPdfText);
    const sections = splitSections(cleanBody);

    // Header parsing
    const allLines = cleanBody.split('\n').filter(l => l.trim());
    const resumoIndex = allLines.findIndex(l => /^(resumo|summary)$/i.test(l.trim()));
    // Pega as primeiras linhas até o resumo ou no máximo 6 linhas
    const limit = resumoIndex > 0 ? Math.min(resumoIndex, 6) : 6;
    const headerLines = allLines.slice(0, limit);

    const perfil = {
        nome: headerLines[0] || null,
        titulo: headerLines[1] || null,
        linkedin: null,
        localizacao: null
    };

    headerLines.forEach(l => {
        if (l.includes('linkedin.com')) perfil.linkedin = l;
        // Validação estrita de local no header também
        if (!perfil.localizacao &&
            (l.includes(',') || /brasil|brazil|paulo|minas|janeiro/i.test(l)) &&
            !l.includes('linkedin') && !l.includes('@')) {
            perfil.localizacao = l;
        }
    });

    const experiences = parseExperiences(sections.experiencia);
    const formacao = parseEducation(sections.formacao);

    const skills = sections.skills
        ? sections.skills.split(/[,·\n]/).map(s => s.trim()).filter(s => s.length > 2)
        : [];

    return {
        perfil,
        resumo: sections.resumo ? sections.resumo.trim() : null,
        experiencias: experiences,
        formacao: formacao,
        skills: [...new Set(skills)]
    };
};
