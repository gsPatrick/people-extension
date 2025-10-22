import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import _ from 'lodash';

// Importando serviços e inicializadores
import { configureLogger, log, error as logError } from './src/utils/logger.service.js';
import { memoryStorageAdapter } from './src/Platform/Storage/memoryStorage.adapter.js';
import { initializeSessionService } from './src/Core/session.service.js';
import { initializeAuthStorage } from './src/Inhire/Auth/authStorage.service.js';
import { performLogin } from './src/Core/Auth-Flow/authOrchestrator.js';
import { sequelize } from './src/models/index.js'; // <- export nomeado
import { syncEntityCache } from './src/utils/sync.service.js';
import { fetchAllJobsWithDetails } from './src/Core/Job-Flow/jobOrchestrator.js';
import { fetchAllTalentsForSync, fetchCandidatesForJob } from './src/Core/management-flow/managementOrchestrator.js'; 
import { getFromCache } from './src/utils/cache.service.js';
import { createUser, findUserByEmail } from './src/Core/User-Flow/userService.js';
import apiRoutes from './src/routes/apiRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;
const JOBS_CACHE_KEY = 'all_jobs_with_details';
const TALENTS_CACHE_KEY = 'all_talents';

/**
 * Sincroniza os models do Sequelize com o banco de dados SQLite.
 */
const initializeDatabase = async () => {
    log('--- INICIALIZAÇÃO DO BANCO DE DADOS (SQLite + Sequelize) ---');
    try {
        log('Sincronizando models com o banco de dados (alter: true)...');
        await sequelize.sync({ alter: true });

        // Cria tabela virtual VSS se não existir
        await sequelize.query(`
            CREATE VIRTUAL TABLE IF NOT EXISTS vss_criteria USING vss0(
                embedding(1536)
            );
        `);
        log('✅ Models e tabela virtual VSS sincronizados com sucesso.');
    } catch (err) {
        logError('Falha crítica ao sincronizar os models/VSS com o banco de dados.', err);
        process.exit(1);
    }
};

const syncJobs = () => syncEntityCache(JOBS_CACHE_KEY, fetchAllJobsWithDetails);
const syncTalents = () => syncEntityCache(TALENTS_CACHE_KEY, fetchAllTalentsForSync);

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

    setInterval(syncJobs, 60000);
    setInterval(syncTalents, 60000);
    log('🔄 Sincronização periódica de Vagas e Talentos agendada a cada 60s.');
};

startServer();
