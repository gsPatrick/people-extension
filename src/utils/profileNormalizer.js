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
        header_context: [], // Linhas antes da primeira seção
        resumo: '',
        experiencia: [],
        formacao: [],
        skills: [],
        certificacoes: [] // Novo campo para separar certificações se encontradas
    };

    let current = 'header_context';

    for (const line of lines) {
        const lower = line.toLowerCase();

        // Âncoras literais estritas
        if (lower === 'resumo' || lower === 'summary') { current = 'resumo'; continue; }
        if (lower === 'experiência' || lower === 'experience') { current = 'experiencia'; continue; }
        if (lower === 'formação acadêmica' || lower === 'education' || lower === 'formação') { current = 'formacao'; continue; }
        if (lower === 'principais competências' || lower === 'competências' || lower === 'skills' || lower === 'top skills') { current = 'skills'; continue; }
        if (lower === 'certifications' || lower === 'certificações') { current = 'certificacoes'; continue; }

        if (lower === 'idiomas' || lower === 'languages' || lower === 'honors & awards' || lower === 'projects') {
            current = 'outros';
            continue;
        }

        if (current === 'header_context') {
            sections.header_context.push(line);
        } else if (current === 'resumo') {
            sections.resumo += (sections.resumo ? '\n' : '') + line;
        } else if (current === 'experiencia') {
            sections.experiencia.push(line);
        } else if (current === 'formacao') {
            sections.formacao.push(line);
        } else if (current === 'skills') {
            sections.skills.push(line);
        } else if (current === 'certificacoes') {
            sections.certificacoes.push(line);
        }
    }

    return sections;
};

export const parseExperiences = (experienceText) => {
    if (!experienceText || typeof experienceText === 'string') {
        // Se vier string, split. Se vier array (do splitSections novo), use.
        // O novo splitSections do write_to_file retorna array no campo experiencia? Não, retorna linhas.
        // O splitSections NOVO retorna arrays.
        // Vamos garantir:
    }

    // Adaptação: Se experienceText for array, join. Se for string, split.
    const lines = Array.isArray(experienceText) ? experienceText : (experienceText || '').split('\n');

    const experiences = [];
    let currentExp = null;

    // Regex para detectar linha de data/duração
    const dateLineRegex = /((?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\s*(?:de\s*)?\d{4}|presente|present|atual)\s*[-–]\s*((?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\s*(?:de\s*)?\d{4}|presente|present|atual)/i;

    let buffer = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (dateLineRegex.test(line)) {
            // LinkedIn PDF Padrão: 
            // 1. Nome Empresa
            // 2. Título Cargo
            // 3. Data

            let cargo = "Cargo Indefinido";
            let empresa = "Empresa Indefinida";

            if (buffer.length >= 2) {
                cargo = buffer.pop();
                empresa = buffer.pop();

                if (currentExp && buffer.length > 0) {
                    currentExp.descricao += (currentExp.descricao ? '\n' : '') + buffer.join('\n');
                }
            } else if (buffer.length === 1) {
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

            // Validação estrita de localização
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

    if (currentExp && buffer.length > 0) {
        currentExp.descricao += (currentExp.descricao ? '\n' : '') + buffer.join('\n');
    }

    return experiences;
};

const parseEducation = (eduLines) => {
    if (!eduLines) return [];

    // Se vier string, split.
    const lines = Array.isArray(eduLines) ? eduLines : (eduLines || '').split('\n');
    const filteredLines = lines.filter(l => l.trim());
    const education = [];

    for (let i = 0; i < filteredLines.length; i++) {
        const line = filteredLines[i];

        // Match ano-ano: 2014 - 2022 ou (2014 - 2022)
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

    // --- LÓGICA REFINADA DE HEADER ---
    // Em vez de pegar line[0], olhamos de baixo para cima no contexto antes do resumo.
    // O PDF do LinkedIn coloca o sidebar antes, então "Conta..." e URL aparecem primeiro.
    // O Nome e Título ficam LOGO ACIMA do Resumo.

    const contextLines = sections.header_context.filter(l => l.trim());
    let nome = null;
    let titulo = null;
    let localizacao = null;
    let linkedin = null;

    // Busca LinkedIn explícito no contexto
    const linkedinLine = contextLines.find(l => l.includes('linkedin.com'));
    if (linkedinLine) linkedin = linkedinLine;

    // Estratégia "Look Behind Resumo":
    // As últimas linhas de header_context são:
    // N-1: Localização (Opcional)
    // N-2: Título
    // N-3: Nome
    // Filtrando lixo de sidebar ("Contato", "Competências", "Certifications")

    // Limpa linhas conhecidas de sidebar
    const cleanContext = contextLines.filter(l => {
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

    if (cleanContext.length > 0) {
        // Pega as últimas 3 linhas candidatas
        const candidates = cleanContext.slice(-3);

        // Tenta identificar localização na última
        const last = candidates[candidates.length - 1];
        if (last && (last.includes(',') || /brasil|brazil|paulo|minas|janeiro/i.test(last))) {
            localizacao = last;
            candidates.pop();
        }

        // O que sobrou?
        if (candidates.length > 0) {
            titulo = candidates.pop(); // Última restante é título
        }
        if (candidates.length > 0) {
            nome = candidates.pop(); // Penúltima restante é nome
        }
    }

    // Se nome e título ainda forem nulos, fallback para início (caso o layout seja antigo)
    if (!nome && cleanContext.length >= 1) nome = cleanContext[0];
    if (!titulo && cleanContext.length >= 2) titulo = cleanContext[1];

    const experiences = parseExperiences(sections.experiencia);
    const formacao = parseEducation(sections.formacao);

    const skills = sections.skills
        // @ts-ignore
        ? sections.skills.join('\n').split(/[,·\n]/).map(s => s.trim()).filter(s => s.length > 2)
        : [];

    // Adiciona skills que podem estar no header ("Principais competências" sidebar) se não foram capturadas
    // (Opcional, mas comum no LinkedIn PDF)

    return {
        perfil: {
            nome,
            titulo,
            linkedin,
            localizacao
        },
        resumo: sections.resumo ? sections.resumo.trim() : null,
        experiencias: experiences,
        formacao: formacao,
        skills: [...new Set(skills)]
    };
};
