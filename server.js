// COLE ESTE CÓDIGO ATUALIZADO NO ARQUIVO: server.js

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
import apiRoutes from './src/routes/apiRoutes.js';

// Importando o db (Sequelize) e os services
import db from './src/models/index.js'; // Importa a instância do Sequelize e os models
import { syncEntityCache } from './src/utils/sync.service.js';
import { fetchAllJobsWithDetails } from './src/Core/Job-Flow/jobOrchestrator.js';
import { fetchAllTalentsForSync, fetchCandidatesForJob } from './src/Core/management-flow/managementOrchestrator.js'; 
import { getFromCache } from './src/utils/cache.service.js';
import { createUser, findUserByEmail } from './src/Core/User-Flow/userService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;
const JOBS_CACHE_KEY = 'all_jobs_with_details';
const TALENTS_CACHE_KEY = 'all_talents';

const syncJobs = () => syncEntityCache(JOBS_CACHE_KEY, fetchAllJobsWithDetails);
const syncTalents = () => syncEntityCache(TALENTS_CACHE_KEY, fetchAllTalentsForSync);

const prefetchAllCandidates = async () => {
  log('--- PREFETCH WORKER: Iniciando pré-carregamento de todos os candidatos ---');
  const allJobs = getFromCache(JOBS_CACHE_KEY);
  if (!allJobs || allJobs.length === 0) {
    logError('PREFETCH WORKER: Não há vagas no cache para buscar candidatos. Pulando.');
    return;
  }
  log(`PREFETCH WORKER: Encontradas ${allJobs.length} vagas. Buscando candidatos para cada uma...`);
  const concurrencyLimit = 5;
  const batches = _.chunk(allJobs, concurrencyLimit);
  for (const batch of batches) {
    await Promise.all(batch.map(job => fetchCandidatesForJob(job.id)));
    log(`PREFETCH WORKER: Lote de ${batch.length} vagas processado.`);
  }
  log('--- PREFETCH WORKER: Pré-carregamento de todos os candidatos concluído. ---');
};

const seedAdminUser = async () => {
    const adminEmail = 'admin@admin.com';
    const existingAdmin = findUserByEmail(adminEmail);
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

  // ==========================================================
  // REMOVE A LÓGICA DE TENTAR CRIAR A EXTENSÃO
  // ==========================================================
  try {
    log('Sincronizando models com o banco de dados (alter: true)...');
    await db.sequelize.sync({ alter: true });
    log('✅ Models sincronizados com sucesso. As tabelas estão prontas.');
  } catch (err) {
    logError('Falha crítica ao sincronizar os models com o banco de dados.', err);
    process.exit(1);
  }

  initializeSessionService(memoryStorageAdapter);
  initializeAuthStorage(memoryStorageAdapter);
  log('✅ Serviços de sessão e autenticação inicializados.');

  await seedAdminUser();
  log('✅ Verificação do usuário admin concluída.');

  const loginResult = await performLogin();
  if (!loginResult.success) {
    logError('Falha crítica no login da InHire. O servidor não pode continuar e será encerrado.');
    process.exit(1);
  }
  log('✅ Login na API da InHire bem-sucedido.');

  log('Realizando a primeira sincronização de VAGAS...');
  await syncJobs();
  log('✅ Sincronização de Vagas concluída.');

  log('Realizando a primeira sincronização de TALENTOS...');
  await syncTalents();
  log('✅ Sincronização de Talentos concluída.');
  
  app.use('/api', apiRoutes);
  log('✅ Rotas da API configuradas.');

  app.listen(PORT, () => {
    log(`🚀 Servidor rodando e ouvindo na porta ${PORT}`);
    
    log('Iniciando pré-carregamento de candidatos em segundo plano...');
    prefetchAllCandidates().catch(err => logError("Erro durante o pré-carregamento em segundo plano:", err));
  });

  // Agendamento de tarefas recorrentes
  setInterval(syncJobs, 60000);
  setInterval(syncTalents, 60000);
  log('🔄 Sincronização periódica de Vagas e Talentos agendada a cada 60 segundos.');
};

startServer();