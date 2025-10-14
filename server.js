// COLE ESTE CÓDIGO NO SEU ARQUIVO: server.js

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
import { initializeCache } from './src/Platform/Cache/cache.service.js'; // Alterado para o novo serviço de cache
import { fetchAllJobsWithDetails } from './src/Core/Job-Flow/jobOrchestrator.js';
import { fetchAllTalentsForSync, fetchCandidatesForJob } from './src/Core/management-flow/managementOrchestrator.js'; 
import { getFromCache } from './src/utils/cache.service.js';
import { syncEntityCache } from './src/utils/sync.service.js';
import { createUser, findUserByEmail } from './src/Core/User-Flow/userService.js'; // Importa funções de usuário

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;
const JOBS_CACHE_KEY = 'all_jobs_with_details';
const TALENTS_CACHE_KEY = 'all_talents';

// Função de sincronização de vagas
const syncJobs = () => syncEntityCache(JOBS_CACHE_KEY, fetchAllJobsWithDetails);
// Função de sincronização de talentos
const syncTalents = () => syncEntityCache(TALENTS_CACHE_KEY, fetchAllTalentsForSync);

// Função para pré-carregar candidatos
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
    await Promise.all(
      batch.map(job => fetchCandidatesForJob(job.id))
    );
    log(`PREFETCH WORKER: Lote de ${batch.length} vagas processado.`);
  }

  log('--- PREFETCH WORKER: Pré-carregamento de todos os candidatos concluído. ---');
};

/**
 * Garante que o usuário administrador padrão exista no banco de dados.
 * Cria o usuário se ele não for encontrado.
 */
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
            process.exit(1); // Encerra o servidor se não conseguir criar o admin
        }
    } else {
        log('Usuário admin já existe.');
    }
};

/**
 * Função principal que inicializa e inicia o servidor.
 */
const startServer = async () => {
  // 1. Configurações básicas e síncronas
  configureLogger({ toFile: true });
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));
  log('--- INICIALIZAÇÃO DO SERVIDOR ---');

  // 2. Inicializa serviços de plataforma (DB, Cache, etc.)
  initializeCache(); // Inicializa o DB SQLite
  initializeSessionService(memoryStorageAdapter);
  initializeAuthStorage(memoryStorageAdapter);
  log('✅ Serviços de cache, sessão e autenticação inicializados.');

  // 3. Garante que o usuário admin exista
  await seedAdminUser();
  log('✅ Verificação do usuário admin concluída.');

  // 4. Realiza o login na API da InHire para obter tokens de serviço
  const loginResult = await performLogin();
  if (!loginResult.success) {
    logError('Falha crítica no login da InHire. O servidor não pode continuar e será encerrado.');
    process.exit(1);
  }
  log('✅ Login na API da InHire bem-sucedido.');

  // 5. Sincronização inicial de dados
  log('Realizando a primeira sincronização de VAGAS...');
  await syncJobs();
  log('✅ Sincronização de Vagas concluída.');

  log('Realizando a primeira sincronização de TALENTOS...');
  await syncTalents();
  log('✅ Sincronização de Talentos concluída.');
  
  // 6. Pré-carregamento de dados derivados
  await prefetchAllCandidates();

  // 7. Agendamento de tarefas recorrentes
  setInterval(syncJobs, 60000);
  setInterval(syncTalents, 60000);
  log('🔄 Sincronização periódica de Vagas e Talentos agendada a cada 60 segundos.');

  // 8. Configura rotas da API
  app.use('/api', apiRoutes);
  log('✅ Rotas da API configuradas.');

  // 9. Inicia o servidor
  app.listen(PORT, () => {
    log(`🚀 Servidor rodando e ouvindo na porta ${PORT}`);
  });
};

// Inicia todo o processo
startServer();