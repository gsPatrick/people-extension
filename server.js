// ARQUIVO COMPLETO E FINAL: server.js

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
import { sequelize } from './src/models/index.js'; // <-- MUDANÇA: Agora importa a instância já configurada
import { syncEntityCache } from './src/utils/sync.service.js';
import { fetchAllJobsWithDetails } from './src/Core/Job-Flow/jobOrchestrator.js';
import { fetchAllTalentsForSync, fetchCandidatesForJob } from './src/Core/management-flow/managementOrchestrator.js'; 
import { getFromCache } from './src/utils/cache.service.js';
import { createUser, findUserByEmail } from './src/Core/User-Flow/userService.js';
import apiRoutes from './src/routes/apiRoutes.js';
import cors from 'cors';
import { initializeVectorDB } from './src/services/vector.service.js'; // <-- 1. IMPORTE O NOVO SERVIÇO

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const JOBS_CACHE_KEY = 'all_jobs_with_details';
const TALENTS_CACHE_KEY = 'all_talents';

/**
 * Inicializa o banco de dados PostgreSQL.
 */
export const initializeDatabase = async () => {
    log('--- INICIALIZAÇÃO DO BANCO DE DADOS (PostgreSQL + Sequelize) ---');
    try {
        // Testa a conexão
        await sequelize.authenticate();
        log('✅ Conexão com o PostgreSQL estabelecida com sucesso.');
        
        // Sincroniza os modelos. `force: true` apaga e recria as tabelas.
        // CUIDADO: Isso apaga todos os dados em cada reinicialização.
        log('Sincronizando models com o banco de dados (force: true)...');
        await sequelize.sync({ force: true });
        log('✅ Models sincronizados com sucesso (tabelas recriadas).');

    } catch (err) {
        logError('Falha crítica ao inicializar o banco de dados PostgreSQL:', {
            message: err.message,
            stack: err.stack,
        });
        process.exit(1);
    }
};

// --- Funções de sincronização (sem alterações) ---
const syncJobs = () => syncEntityCache(JOBS_CACHE_KEY, fetchAllJobsWithDetails);
const syncTalents = () => syncEntityCache(TALENTS_CACHE_KEY, fetchAllTalentsForSync);

// --- Pré-carregamento de candidatos (sem alterações) ---
const prefetchAllCandidates = async () => {
    log('--- PREFETCH WORKER: Iniciando pré-carregamento de candidatos InHire ---');
    const allJobs = getFromCache(JOBS_CACHE_KEY);
    if (!allJobs || allJobs.length === 0) {
        logError('PREFETCH WORKER: Não há vagas InHire no cache para buscar candidatos. Pulando.');
        return;
    }
    log(`PREFETCH WORKER: Encontradas ${allJobs.length} vagas. Buscando candidatos...`);
    const concurrencyLimit = 5;
    const batches = _.chunk(allJobs, concurrencyLimit);
    for (const batch of batches) {
        await Promise.all(batch.map(job => fetchCandidatesForJob(job.id)));
        log(`PREFETCH WORKER: Lote de ${batch.length} vagas processado.`);
    }
    log('--- PREFETCH WORKER: Pré-carregamento concluído. ---');
};

// --- Criação do usuário admin (sem alterações) ---
const seedAdminUser = async () => {
    const adminEmail = 'admin@admin.com';
    const existingAdmin = await findUserByEmail(adminEmail);
    if (!existingAdmin) {
        log('Nenhum usuário admin encontrado. Criando um novo...');
        try {
            await createUser({
                name: 'Administrador',
                email: adminEmail,
                password: 'senhasuperdificil',
                role: 'admin'
            });
            log('✅ Usuário admin criado com sucesso.');
        } catch (err) {
            logError('Falha crítica ao criar o usuário admin:', err.message);
            process.exit(1);
        }
    } else {
        log('Usuário admin já existe.');
    }
};

// --- Inicialização do servidor ---
const startServer = async () => {
    const app = express();

    configureLogger({ toFile: true });
    
    app.use(cors());
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));
    log('--- INICIALIZAÇÃO DO SERVIDOR ---');

    // <-- MUDANÇA: A lógica de remoção de arquivo e VSS foi removida.
    await initializeDatabase();
    // <-- 2. ADICIONE A CHAMADA DE INICIALIZAÇÃO DO LANCEDB AQUI
    await initializeVectorDB(); 

    initializeSessionService(memoryStorageAdapter);
    initializeAuthStorage(memoryStorageAdapter);
    log('✅ Serviços de sessão e autenticação InHire inicializados.');

    await seedAdminUser();
    log('✅ Verificação do usuário admin local concluída.');

    const loginResult = await performLogin();
    if (!loginResult.success) {
        logError('Falha crítica no login da InHire. O servidor não pode continuar.');
        process.exit(1);
    }
    log('✅ Login na API da InHire bem-sucedido.');

    log('Realizando a primeira sincronização de VAGAS da InHire...');
    await syncJobs();
    log('✅ Sincronização de Vagas concluída.');

    log('Realizando a primeira sincronização de TALENTOS da InHire...');
    await syncTalents();
    log('✅ Sincronização de Talentos concluída.');

    app.use('/api', apiRoutes);
    log('✅ Rotas da API configuradas.');

    app.listen(PORT, () => {
        log(`🚀 Servidor rodando e ouvindo na porta ${PORT}`);
        log('Iniciando pré-carregamento de candidatos em segundo plano...');
        prefetchAllCandidates().catch(err => logError("Erro durante o pré-carregamento:", err));
    });

    setInterval(syncJobs, 60000);
    setInterval(syncTalents, 60000);
    log('🔄 Sincronização periódica agendada a cada 60s.');
};

startServer();