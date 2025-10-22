// ARQUIVO COMPLETO (VERSÃO DE DEPURAÇÃO 1): server.js

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import _ from 'lodash';
import express from 'express';
import cors from 'cors';
import { createRequire } from 'node:module';

// --- IMPORTS QUE NÃO DEPENDEM DO BANCO DE DADOS ---
import { configureLogger, log, error as logError } from './src/utils/logger.service.js';
import { memoryStorageAdapter } from './src/Platform/Storage/memoryStorage.adapter.js';
import { initializeSessionService } from './src/Core/session.service.js';
import { initializeSequelize, sequelize as getSequelizeInstance } from './src/models/index.js';

// --- CONFIGURAÇÃO INICIAL ---
// const require = createRequire(import.meta.url);
// const sqliteVss = require('sqlite-vss'); // <-- REMOVIDO TEMPORARIAMENTE
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 4000;
const DB_FILE_PATH = path.join(process.cwd(), 'database.sqlite');

// --- LIMPEZA GARANTIDA ---
if (process.env.NODE_ENV !== 'production') {
    log('[DB_CLEANUP] Modo Dev: Forçando recriação do banco de dados...');
    fs.rmSync(DB_FILE_PATH, { force: true, recursive: true });
    log('[DB_CLEANUP] ✅ Arquivo `database.sqlite` antigo removido.');
}

const startServer = async () => {
    // --- PASSO 1: INICIALIZAÇÃO DO SEQUELIZE E DOS MODELS ---
    await initializeSequelize();
    log('✅ Conexão com Sequelize e modelos carregados.');

    // --- PASSO 2: IMPORTS DINÂMICOS ---
    const { default: apiRoutes } = await import('./src/routes/apiRoutes.js');
    const { initializeAuthStorage } = await import('./src/Inhire/Auth/authStorage.service.js');
    const { performLogin } = await import('./src/Core/Auth-Flow/authOrchestrator.js');
    const { syncEntityCache } = await import('./src/utils/sync.service.js');
    const { fetchAllJobsWithDetails } = await import('./src/Core/Job-Flow/jobOrchestrator.js');
    const { fetchAllTalentsForSync, fetchCandidatesForJob } = await import('./src/Core/management-flow/managementOrchestrator.js');
    const { getFromCache } = await import('./src/utils/cache.service.js');
    const { createUser, findUserByEmail } = await import('./src/Core/User-Flow/userService.js');
    
    // --- PASSO 3: INICIALIZAÇÃO DO EXPRESS ---
    const app = express();
    configureLogger({ toFile: true });
    app.use(cors());
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));
    log('--- INICIALIZAÇÃO DO SERVIDOR ---');

    // --- PASSO 4: SINCRONIZAÇÃO DA ESTRUTURA DO BANCO DE DADOS ---
    const sequelize = getSequelizeInstance();
    try {
        log('Sincronizando models com o banco de dados (force: true)...');
        await sequelize.sync({ force: true });
        log('✅ Estrutura do banco de dados sincronizada com sucesso.');

        // --- LÓGICA VSS REMOVIDA TEMPORARIAMENTE ---
        log('⚠️ AVISO: Integração com sqlite-vss está desativada para depuração.');

    } catch (err) {
        logError('❌ Falha crítica ao sincronizar DB:', err);
        process.exit(1);
    }
    
    // --- PASSO 5: RESTANTE DA LÓGICA DE STARTUP ---
    initializeSessionService(memoryStorageAdapter);
    initializeAuthStorage(memoryStorageAdapter);
    
    const adminExists = await findUserByEmail('admin@admin.com');
    if (!adminExists) {
        await createUser({ name: 'Administrador', email: 'admin@admin.com', password: 'senhasuperdificil', role: 'admin' });
    }

    const loginResult = await performLogin();
    if (!loginResult.success) {
        logError('❌ Falha crítica no login da InHire. Encerrando.');
        process.exit(1);
    }
    
    const JOBS_CACHE_KEY = 'all_jobs_with_details';
    const TALENTS_CACHE_KEY = 'all_talents';
    await syncEntityCache(JOBS_CACHE_KEY, fetchAllJobsWithDetails);
    await syncEntityCache(TALENTS_CACHE_KEY, fetchAllTalentsForSync);

    app.use('/api', apiRoutes);
    log('✅ Rotas da API configuradas.');

    app.listen(PORT, () => {
        log(`🚀 Servidor rodando na porta ${PORT}`);
        const allJobs = getFromCache(JOBS_CACHE_KEY);
        if (allJobs?.length > 0) {
            const batches = _.chunk(allJobs, 5);
            for (const batch of batches) {
                Promise.all(batch.map(job => fetchCandidatesForJob(job.id)));
            }
        }
    });

    setInterval(() => syncEntityCache(JOBS_CACHE_KEY, fetchAllJobsWithDetails), 60000);
    setInterval(() => syncEntityCache(TALENTS_CACHE_KEY, fetchAllTalentsForSync), 60000);
};

// --- Inicia todo o processo ---
startServer().catch(err => {
    // Adicionamos um log mais detalhado aqui
    logError('❌ Erro fatal e não capturado durante a inicialização do servidor:', err);
    process.exit(1);
});