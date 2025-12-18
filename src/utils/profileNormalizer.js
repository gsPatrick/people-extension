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
        .filter(line => line && line.length > 0) // Strict empty line filter
        .join('\n');
};

// Global Regex Constants
const KW_RESUMO = /^(resumo|summary)$/i;
const KW_XP = /^(experiência|experience)$/i;
const KW_EDU = /^(formação acadêmica|education|formação)$/i;
const KW_SKILLS = /^(principais competências|competências|skills|top skills)$/i;
const KW_CERT = /^(certifications|certificações)$/i;
const KW_IGNORE = /^(idiomas|languages|honors & awards|projects|projetos)$/i;

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
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (!foundResumo && KW_RESUMO.test(trimmed)) {
            sections._meta.lastSectionBeforeResumo = current;
            if (current === 'header_context') sections._meta.dataBeforeResumo = [...sections.header_context];
            else if (Array.isArray(sections[current])) sections._meta.dataBeforeResumo = [...sections[current]];

            foundResumo = true;
            current = 'resumo';
            continue;
        }

        if (KW_XP.test(trimmed)) { current = 'experiencia'; continue; }
        if (KW_EDU.test(trimmed)) { current = 'formacao'; continue; }
        if (KW_SKILLS.test(trimmed)) { current = 'skills'; continue; }
        if (KW_CERT.test(trimmed)) { current = 'certificacoes'; continue; }
        if (KW_IGNORE.test(trimmed)) { current = 'outros'; continue; }

        if (Array.isArray(sections[current])) {
            sections[current].push(line);
        } else if (current === 'resumo') {
            sections.resumo += (sections.resumo ? '\n' : '') + line;
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
        if (!line.trim()) continue;

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
            buffer.push(line);
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

    let nome = null;
    let titulo = null;
    let localizacao = null;
    let linkedin = null;

    const contextLines = sections.header_context.filter(l => l.trim());
    const linkedinLine = contextLines.find(l => l.includes('linkedin.com'));
    if (linkedinLine) linkedin = linkedinLine;

    const extractFromTail = (linesSource) => {
        // Filter out trash
        const clean = linesSource.filter(l => {
            if (!l || !l.trim()) return false;
            const lower = l.toLowerCase();
            return !l.includes('linkedin.com') &&
                lower !== 'contato' &&
                !lower.includes('(linkedin)') &&
                !lower.startsWith('page ') &&
                !lower.includes('www.') &&
                !KW_SKILLS.test(lower) &&
                !KW_CERT.test(lower);
        });

        let n = null, t = null, l = null;

        if (clean.length > 0) {
            // Take up to last 6 meaningful lines
            let candidates = clean.slice(-6);

            // 1. Identify Location (Bottom-Up)
            for (let i = candidates.length - 1; i >= 0; i--) {
                const item = candidates[i];
                if (!l && (item.includes(',') || /brasil|brazil|paulo|minas|rio|janeiro|united states|kingdom|portugal/i.test(item))) {
                    l = item;
                    candidates.splice(i, 1);
                    break;
                }
            }

            // 2. Identify Name vs Title (Top-Down on remaining)
            if (candidates.length > 0) {
                const first = candidates[0];
                const looksLikeTitle = /(engineer|developer|desenvolvedor|analyst|analista|specialist|especialista|manager|gerente|consultant|consultor|\||—|-)/i.test(first) || first.length > 40;

                if (!looksLikeTitle) {
                    n = candidates.shift(); // First is Name
                }

                // Everything else is Title part (join them)
                if (candidates.length > 0) {
                    t = candidates.join(' ');
                }
            }
        }
        return { nome: n, titulo: t, localizacao: l };
    };

    const res1 = extractFromTail(contextLines);
    nome = res1.nome;
    titulo = res1.titulo;
    localizacao = res1.localizacao;

    if (!nome && sections._meta.lastSectionBeforeResumo !== 'header_context') {
        const trappedLines = sections._meta.dataBeforeResumo || [];
        const res2 = extractFromTail(trappedLines);
        if (res2.nome || res2.titulo) {
            // Priority update if found better info in trapped
            if (res2.nome) nome = res2.nome;
            if (res2.titulo) titulo = res2.titulo;
            if (res2.localizacao) localizacao = res2.localizacao;
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
