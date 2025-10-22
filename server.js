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
import { createRequire } from 'node:module';
import cors from 'cors'; // <--- ADICIONADO

const require = createRequire(import.meta.url); // Necessário para sqlite-vss
const sqliteVss = require('sqlite-vss');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const JOBS_CACHE_KEY = 'all_jobs_with_details';
const TALENTS_CACHE_KEY = 'all_talents';

/**
 * Inicializa o banco de dados e carrega VSS.
 */
export const initializeDatabase = async () => {
    log('--- INICIALIZAÇÃO DO BANCO DE DADOS (SQLite + Sequelize) ---');
    
    try {
        // --- Sincroniza modelos (ATENÇÃO: force:true apaga tabelas existentes) ---
        log('Sincronizando models com o banco de dados (force: true)...');
        await sequelize.sync({ force: true });
        log('✅ Models sincronizados com sucesso (tabelas recriadas).');

        // --- Carregamento da extensão VSS via sqlite-vss ---
        try {
            log('🔍 Carregando extensão VSS via sqlite-vss...');
            await sqliteVss.load(sequelize);
            log('✅ Extensão VSS carregada com sucesso.');

            // Criação da tabela virtual VSS
            await sequelize.query(`
                CREATE VIRTUAL TABLE IF NOT EXISTS vss_criteria USING vss0(
                    embedding(1536)
                );
            `);
            log('✅ Tabela virtual VSS criada com sucesso.');

        } catch (vssError) {
            logError('Não foi possível carregar VSS (busca vetorial desabilitada):', {
                message: vssError.message,
                hint: 'Verifique se o sqlite-vss está instalado corretamente e se foi rebuild se necessário'
            });
            log('⚠️ Servidor continuará sem suporte a VSS (busca vetorial).');
        }

    } catch (err) {
        logError('Falha crítica ao inicializar banco de dados:', {
            message: err.message,
            stack: err.stack,
            originalError: err.original?.message
        });
        process.exit(1);
    }
};

// --- Funções de sincronização ---
const syncJobs = () => syncEntityCache(JOBS_CACHE_KEY, fetchAllJobsWithDetails);
const syncTalents = () => syncEntityCache(TALENTS_CACHE_KEY, fetchAllTalentsForSync);

// --- Pré-carregamento de candidatos ---
const prefetchAllCandidates = async () => {
    log('--- PREFETCH WORKER: Iniciando pré-carregamento de candidatos InHire ---');
    const allJobs = getFromCache(JOBS_CACHE_KEY);
    if (!allJobs || allJobs.length === 0) {
        logError('PREFETCH WORKER: Não há vagas InHire no cache para buscar candidatos. Pulando.');
        return;
    }
    log(`PREFETCH WORKER: Encontradas ${allJobs.length} vagas. Buscando candidatos para cada uma...`);
    const concurrencyLimit = 5;
    const batches = _.chunk(allJobs, concurrencyLimit);
    for (const batch of batches) {
        await Promise.all(batch.map(job => fetchCandidatesForJob(job.id)));
        log(`PREFETCH WORKER: Lote de ${batch.length} vagas processado.`);
    }
    log('--- PREFETCH WORKER: Pré-carregamento de candidatos InHire concluído. ---');
};

// --- Criação do usuário admin ---
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
    const app = express(); // ✅ Necessário para corrigir ReferenceError

    configureLogger({ toFile: true });
    app.use(cors());
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));
    log('--- INICIALIZAÇÃO DO SERVIDOR ---');

    await initializeDatabase();

    initializeSessionService(memoryStorageAdapter);
    initializeAuthStorage(memoryStorageAdapter);
    log('✅ Serviços de sessão e autenticação InHire inicializados.');

    await seedAdminUser();
    log('✅ Verificação do usuário admin local concluída.');

    const loginResult = await performLogin();
    if (!loginResult.success) {
        logError('Falha crítica no login da InHire. O servidor não pode continuar e será encerrado.');
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
        log('Iniciando pré-carregamento de candidatos da InHire em segundo plano...');
        prefetchAllCandidates().catch(err => logError("Erro durante o pré-carregamento em segundo plano:", err));
    });

    // Sincronização periódica a cada 60 segundos
    setInterval(syncJobs, 60000);
    setInterval(syncTalents, 60000);
    log('🔄 Sincronização periódica de Vagas e Talentos agendada a cada 60s.');
};

startServer();
