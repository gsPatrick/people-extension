// ARQUIVO COMPLETO: server.js (Fluxo de Inicialização Sequencial e Seguro)

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
import { sequelize } from './src/models/index.js';
import { syncEntityCache } from './src/utils/sync.service.js';
import { fetchAllJobsWithDetails } from './src/Core/Job-Flow/jobOrchestrator.js';
import { fetchAllTalentsForSync, fetchCandidatesForJob } from './src/Core/management-flow/managementOrchestrator.js'; 
import { getFromCache } from './src/utils/cache.service.js';
import { createUser, findUserByEmail } from './src/Core/User-Flow/userService.js';
import apiRoutes from './src/routes/apiRoutes.js';
import cors from 'cors';
import { initializeVectorDB } from './src/services/vector.service.js';
import * as scorecardService from './src/services/scorecard.service.js'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const JOBS_CACHE_KEY = 'all_jobs_with_details';
const TALENTS_CACHE_KEY = 'all_talents';

export const initializeDatabase = async () => {
    log('--- INICIALIZAÇÃO DO BANCO DE DADOS (PostgreSQL + Sequelize) ---');
    try {
        await sequelize.authenticate();
        log('✅ Conexão com o PostgreSQL estabelecida com sucesso.');
        
        log('Sincronizando models com o banco de dados (force: true)...');
        await sequelize.sync({ force: true });
        log('✅ Models sincronizados com sucesso (tabelas recriadas).');
    } catch (err) {
        logError('Falha crítica ao inicializar o banco de dados PostgreSQL:', { message: err.message, stack: err.stack });
        process.exit(1);
    }
};

const syncJobs = () => syncEntityCache(JOBS_CACHE_KEY, fetchAllJobsWithDetails);
const syncTalents = () => syncEntityCache(TALENTS_CACHE_KEY, fetchAllTalentsForSync);

const prefetchAllCandidates = async () => {
    log('--- PREFETCH WORKER: Iniciando pré-carregamento de candidatos InHire (em segundo plano) ---');
    const allJobs = getFromCache(JOBS_CACHE_KEY);
    if (!allJobs || allJobs.length === 0) {
        logError('PREFETCH WORKER: Não há vagas no cache para buscar candidatos. Pulando.');
        return;
    }
    log(`PREFETCH WORKER: Encontradas ${allJobs.length} vagas. Buscando candidatos...`);
    const concurrencyLimit = 5;
    const batches = _.chunk(allJobs, concurrencyLimit);
    for (const batch of batches) {
        await Promise.all(batch.map(job => fetchCandidatesForJob(job.id)));
        log(`PREFETCH WORKER: Lote de ${batch.length} vagas processado.`);
    }
    log('--- PREFETCH WORKER: Pré-carregamento de candidatos concluído. ---');
};

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

const startServer = async () => {
    const app = express();
    configureLogger({ toFile: true });
    
    app.use(cors());
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));
    log('--- INICIALIZAÇÃO DO SERVIDOR ---');

    // 1. Inicializa os bancos de dados
    await initializeDatabase();
    await initializeVectorDB();

    // 2. Inicializa serviços básicos
    initializeSessionService(memoryStorageAdapter);
    initializeAuthStorage(memoryStorageAdapter);
    log('✅ Serviços de sessão e autenticação InHire inicializados.');

    await seedAdminUser();
    log('✅ Verificação do usuário admin local concluída.');

    // 3. Autentica com a API externa
    const loginResult = await performLogin();
    if (!loginResult.success) {
        logError('Falha crítica no login da InHire. O servidor não pode continuar.');
        process.exit(1);
    }
    log('✅ Login na API da InHire bem-sucedido.');

    // --- MUDANÇA CRÍTICA: AGUARDA TODAS AS SINCRONIZAÇÕES INICIAIS ---
    log('Realizando a primeira sincronização de TODOS os dados essenciais...');

    // Usamos Promise.all para rodar as sincronizações em paralelo, mas esperamos que TODAS terminem.
    try {
        await Promise.all([
            scorecardService.findAll(), // Carrega e cacheia os scorecards
            syncJobs(),               // Carrega e cacheia as vagas
            syncTalents()             // Carrega e cacheia os talentos
        ]);
        log('✅ Sincronização inicial de Scorecards, Vagas e Talentos concluída.');
    } catch (err) {
        logError('Falha crítica durante a sincronização inicial de dados:', err.message);
        process.exit(1);
    }
    // --- FIM DA MUDANÇA ---

    // 4. Configura as rotas da API, agora que os dados estão prontos
    app.use('/api', apiRoutes);
    log('✅ Rotas da API configuradas e prontas para receber requisições.');

    // 5. Inicia o servidor para aceitar conexões
    app.listen(PORT, () => {
        log(`🚀 Servidor rodando e ouvindo na porta ${PORT}`);
        // O pré-carregamento de candidatos pode continuar em segundo plano, pois não é crítico para a primeira resposta
        prefetchAllCandidates().catch(err => logError("Erro durante o pré-carregamento em segundo plano:", err));
    });

    // 6. Agenda as sincronizações periódicas
    setInterval(syncJobs, 60000);
    setInterval(syncTalents, 60000);
    log('🔄 Sincronização periódica agendada a cada 60s.');
};

startServer();