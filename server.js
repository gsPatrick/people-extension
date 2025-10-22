// ARQUIVO COMPLETO: server.js

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import _ from 'lodash';
import express from 'express';
import { configureLogger, log, error as logError } from './src/utils/logger.service.js';
import { memoryStorageAdapter } from './src/Platform/Storage/memoryStorage.adapter.js';
import { initializeSessionService } from './src/Core/session.service.js';
import { initializeAuthStorage } from './src/Inhire/Auth/authStorage.service.js';
import { performLogin } from './src/Core/Auth-Flow/authOrchestrator.js';

// <-- MUDANÇA CRÍTICA: Importamos a FUNÇÃO de inicialização, não a instância.
import { initializeSequelize, sequelize as getSequelizeInstance } from './src/models/index.js';

import { syncEntityCache } from './src/utils/sync.service.js';
import { fetchAllJobsWithDetails } from './src/Core/Job-Flow/jobOrchestrator.js';
import { fetchAllTalentsForSync, fetchCandidatesForJob } from './src/Core/management-flow/managementOrchestrator.js';
import { getFromCache } from './src/utils/cache.service.js';
import { createUser, findUserByEmail } from './src/Core/User-Flow/userService.js';
import apiRoutes from './src/routes/apiRoutes.js';
import { createRequire } from 'node:module';
import cors from 'cors';

const require = createRequire(import.meta.url);
const sqliteVss = require('sqlite-vss');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const DB_FILE_PATH = path.join(process.cwd(), 'database.sqlite');
const CACHE_DB_PATH = path.join(process.cwd(), 'local_cache.sqlite');

// --- PASSO 1: LIMPEZA GARANTIDA ---
// Esta função é chamada antes de qualquer coisa relacionada ao banco de dados.
const ensureFreshDatabase = () => {
    if (process.env.NODE_ENV !== 'production') {
        log('[DB_CLEANUP] Forçando recriação do banco de dados em modo de desenvolvimento...');
        try {
            fs.rmSync(DB_FILE_PATH, { force: true });
            fs.rmSync(CACHE_DB_PATH, { force: true });
            log('[DB_CLEANUP] ✅ Arquivos de banco de dados antigos removidos.');
        } catch (err) {
            logError('[DB_CLEANUP] ❌ Falha crítica ao remover arquivos de banco de dados:', err.message);
            process.exit(1);
        }
    }
};

const initializeDatabase = async () => {
    log('--- INICIALIZAÇÃO DO BANCO DE DADOS (SQLite + Sequelize) ---');
    try {
        const sequelize = getSequelizeInstance(); // Pega a instância já criada
        log('Sincronizando models com o banco de dados (force: true)...');
        await sequelize.sync({ force: true });
        log('✅ Models sincronizados com sucesso (tabelas recriadas).');
        try {
            log('🔍 Carregando extensão VSS via sqlite-vss...');
            await sqliteVss.load(sequelize);
            log('✅ Extensão VSS carregada com sucesso.');
            await sequelize.query(`
                CREATE VIRTUAL TABLE IF NOT EXISTS vss_criteria USING vss0(
                    embedding(1536)
                );
            `);
            log('✅ Tabela virtual VSS criada com sucesso.');
        } catch (vssError) {
            logError('Não foi possível carregar VSS:', { message: vssError.message });
            log('⚠️ Servidor continuará sem suporte a VSS (busca vetorial).');
        }
    } catch (err) {
        logError('Falha crítica ao inicializar banco de dados:', err);
        process.exit(1);
    }
};


// --- INICIALIZAÇÃO DO SERVIDOR ---
const startServer = async () => {
    const app = express();
    configureLogger({ toFile: true });
    
    // --- ORDEM CORRETA DE OPERAÇÕES ---
    // 1. Limpa os arquivos físicos do disco.
    ensureFreshDatabase();

    // 2. AGORA SIM, inicializa o Sequelize, que criará a conexão com um "terreno limpo".
    await initializeSequelize();
    
    app.use(cors());
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));
    log('--- INICIALIZAÇÃO DO SERVIDOR ---');

    // 3. Com a conexão e os models prontos, sincroniza a estrutura das tabelas.
    await initializeDatabase();

    // O resto do código permanece o mesmo...
    const JOBS_CACHE_KEY = 'all_jobs_with_details';
    const TALENTS_CACHE_KEY = 'all_talents';

    initializeSessionService(memoryStorageAdapter);
    initializeAuthStorage(memoryStorageAdapter);
    log('✅ Serviços de sessão e autenticação InHire inicializados.');

    await seedAdminUser();
    
    const loginResult = await performLogin();
    if (!loginResult.success) {
        logError('Falha crítica no login da InHire. Encerrando.');
        process.exit(1);
    }
    
    await syncEntityCache(JOBS_CACHE_KEY, fetchAllJobsWithDetails);
    await syncEntityCache(TALENTS_CACHE_KEY, fetchAllTalentsForSync);

    app.use('/api', apiRoutes);
    log('✅ Rotas da API configuradas.');

    app.listen(PORT, () => {
        log(`🚀 Servidor rodando na porta ${PORT}`);
        prefetchAllCandidates().catch(err => logError("Erro durante o pré-carregamento:", err));
    });

    setInterval(() => syncEntityCache(JOBS_CACHE_KEY, fetchAllJobsWithDetails), 60000);
    setInterval(() => syncEntityCache(TALENTS_CACHE_KEY, fetchAllTalentsForSync), 60000);
};

// Funções auxiliares que não mudam
const seedAdminUser = async () => {
    const adminEmail = 'admin@admin.com';
    const existingAdmin = await findUserByEmail(adminEmail);
    if (!existingAdmin) {
        log('Nenhum usuário admin encontrado. Criando um novo...');
        await createUser({ name: 'Administrador', email: adminEmail, password: 'senhasuperdificil', role: 'admin' });
        log('✅ Usuário admin criado com sucesso.');
    }
};
const prefetchAllCandidates = async () => {
    const allJobs = getFromCache('all_jobs_with_details');
    if (!allJobs || allJobs.length === 0) return;
    const batches = _.chunk(allJobs, 5);
    for (const batch of batches) {
        await Promise.all(batch.map(job => fetchCandidatesForJob(job.id)));
    }
    log('--- PREFETCH WORKER: Pré-carregamento de candidatos concluído. ---');
};

// Inicia tudo
startServer();