export const normalizeDate = (dateText) => {
    if (!dateText) return null;
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

    const match = dateText.match(/([a-zA-Zç]+)\s+(?:de\s+)?(\d{4})/i);
    if (match) {
        const monthVal = MONTHS[match[1].toLowerCase()];
        if (monthVal) return `${match[2]}-${monthVal}`;
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
        .filter((line, i, arr) => line || (arr[i - 1] && arr[i - 1].trim().length > 0))
        .join('\n');
};

export const splitSections = (text) => {
    const lines = text.split('\n');
    const sections = {
        header_context: [],
        resumo: '',
        experiencia: [],
        formacao: [],
        skills: [],
        certificacoes: [],
        outros: [],
        _meta: {
            lastSectionBeforeResumo: 'header_context',
            dataBeforeResumo: []
        }
    };

    let current = 'header_context';
    let foundResumo = false;

    for (const line of lines) {
        const lower = line.toLowerCase();

        // Se encontrarmos Resumo, travamos o "Last Section"
        if (!foundResumo && (lower === 'resumo' || lower === 'summary')) {
            sections._meta.lastSectionBeforeResumo = current;
            // Salva referência aos dados da última seção para recuperação
            if (current !== 'header_context') {
                // @ts-ignore
                sections._meta.dataBeforeResumo = sections[current];
            } else {
                sections._meta.dataBeforeResumo = sections.header_context;
            }

            foundResumo = true;
            current = 'resumo';
            continue;
        }

        if (lower === 'experiência' || lower === 'experience') { current = 'experiencia'; continue; }
        if (lower === 'formação acadêmica' || lower === 'education' || lower === 'formação') { current = 'formacao'; continue; }
        if (lower === 'principais competências' || lower === 'competências' || lower === 'skills' || lower === 'top skills') { current = 'skills'; continue; }
        if (lower === 'certifications' || lower === 'certificações') { current = 'certificacoes'; continue; }

        if (lower === 'idiomas' || lower === 'languages' || lower === 'honors & awards' || lower === 'projects') {
            current = 'outros';
            continue;
        }

        // Adiciona linha à seção atual
        if (Array.isArray(sections[current])) {
            sections[current].push(line);
        } else {
            // Caso resumo (string)
            if (current === 'resumo') sections.resumo += (sections.resumo ? '\n' : '') + line;
        }
    }

    return sections;
};

export const parseExperiences = (experienceText) => {
    const lines = Array.isArray(experienceText) ? experienceText : (experienceText || '').split('\n');
    const experiences = [];
    let currentExp = null;
    const dateLineRegex = /((?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\s*(?:de\s*)?\d{4}|presente|present|atual)\s*[-–]\s*((?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\s*(?:de\s*)?\d{4}|presente|present|atual)/i;
    let buffer = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (dateLineRegex.test(line)) {
            let cargo = "Cargo Indefinido";
            let empresa = "Empresa Indefinida";
            if (buffer.length >= 2) {
                cargo = buffer.pop();
                empresa = buffer.pop();
                if (currentExp && buffer.length > 0) currentExp.descricao += (currentExp.descricao ? '\n' : '') + buffer.join('\n');
            } else if (buffer.length === 1) {
                empresa = buffer.pop();
            }

            const dates = line.match(/((?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\s*(?:de\s*)?\d{4}|presente|present|atual)/gi);
            currentExp = {
                empresa: empresa,
                cargo: cargo,
                localizacao: null,
                inicio: normalizeDate(dates ? dates[0] : null),
                fim: normalizeDate(dates && dates.length > 1 ? dates[1] : null),
                descricao: ""
            };
            experiences.push(currentExp);
            buffer = [];
            if (i + 1 < lines.length) {
                const nextLine = lines[i + 1];
                if (nextLine.length < 60 && (nextLine.includes(',') || /brasil|brazil|united states|eua|remoto|remote/i.test(nextLine))) {
                    if (!dateLineRegex.test(nextLine)) {
                        currentExp.localizacao = nextLine;
                        i++;
                    }
                }
            }
        } else {
            if (line.trim()) buffer.push(line);
        }
    }
    if (currentExp && buffer.length > 0) currentExp.descricao += (currentExp.descricao ? '\n' : '') + buffer.join('\n');
    return experiences;
};

const parseEducation = (eduLines) => {
    if (!eduLines) return [];
    const lines = Array.isArray(eduLines) ? eduLines : (eduLines || '').split('\n');
    const filteredLines = lines.filter(l => l.trim());
    const education = [];
    for (let i = 0; i < filteredLines.length; i++) {
        const line = filteredLines[i];
        const dateMatch = line.match(/(\d{4})\s*[-–]\s*(\d{4})/);
        if (dateMatch) {
            const curso = i > 0 ? filteredLines[i - 1] : "Curso Indefinido";
            const instituicao = i > 1 ? filteredLines[i - 2] : (i > 0 ? "Instituição (Verificar)" : "Instituição Indefinida");
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

    // --- ESTRATÉGIA MISTA DE RECUPERAÇÃO DE NOME ---

    let nome = null;
    let titulo = null;
    let localizacao = null;
    let linkedin = null;

    // 1. Contexto Normal (Antes de qualquer seção)
    const contextLines = sections.header_context.filter(l => l.trim());
    const linkedinLine = contextLines.find(l => l.includes('linkedin.com'));
    if (linkedinLine) linkedin = linkedinLine;

    // Função Scan (Procura Nome/Titulo em um array de linhas, de baixo p/ cima)
    // Retorna {nome, titulo, localizacao}
    const extractFromTail = (linesSource) => {
        const clean = linesSource.filter(l => {
            const lower = l.toLowerCase();
            return !l.includes('linkedin.com') &&
                lower !== 'contato' &&
                lower !== '(linkedin)' &&
                !lower.startsWith('page ') &&
                lower !== 'principais competências' &&
                lower !== 'certifications' &&
                lower !== 'certificações' &&
                !l.includes('www.');
        });

        let n = null, t = null, l = null;
        if (clean.length > 0) {
            const candidates = clean.slice(-3);
            const last = candidates[candidates.length - 1];
            if (last && (last.includes(',') || /brasil|brazil|paulo|minas|janeiro/i.test(last))) {
                l = last;
                candidates.pop();
            }
            if (candidates.length > 0) t = candidates.pop();
            if (candidates.length > 0) n = candidates.pop();

            // Fallback se não achou local
            if (!n && clean.length >= 1) n = clean[0];
            if (!t && clean.length >= 2) t = clean[1];
        }
        return { nome: n, titulo: t, localizacao: l };
    };

    // Tentativa 1: Header Context
    const res1 = extractFromTail(contextLines);
    nome = res1.nome;
    titulo = res1.titulo;
    localizacao = res1.localizacao;

    // Tentativa 2: "Trapped Name" (Nome preso na seção anterior ao Resumo)
    // Se falhou e existe uma "lastSection" que não é o header_context
    if (!nome && sections._meta.lastSectionBeforeResumo !== 'header_context') {
        const trappedLines = sections._meta.dataBeforeResumo || [];
        // Pega apenas as últimas 4 linhas dessa seção, onde o nome estaria
        const potentialHeader = trappedLines.slice(-4);

        const res2 = extractFromTail(potentialHeader);
        if (res2.nome) {
            nome = res2.nome;
            titulo = res2.titulo;
            localizacao = res2.localizacao || localizacao;

            // Remove as linhas usadas da seção original para limpar o dado
            // (Opcional, mas bom para não sujar skills com o nome)
            const sectionName = sections._meta.lastSectionBeforeResumo;
            if (Array.isArray(sections[sectionName])) {
                // Remove as ultimas lines correspondentes
                // Simplificação: apenas aceita a extração
            }
        }
    }

    const experiences = parseExperiences(sections.experiencia);
    const formacao = parseEducation(sections.formacao);
    const skills = sections.skills
        // @ts-ignore
        ? sections.skills.join('\n').split(/[,·\n]/).map(s => s.trim()).filter(s => s.length > 2)
        : [];

    return {
        perfil: { nome, titulo, linkedin, localizacao },
        resumo: sections.resumo ? sections.resumo.trim() : null,
        experiencias: experiences,
        formacao: formacao,
        skills: [...new Set(skills)]
    };
};
