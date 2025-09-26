// meu-projeto-backend/server.js

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
import { initializeCache } from './src/Platform/Storage/localCache.service.js';
import { fetchAllJobsWithDetails } from './src/Core/Job-Flow/jobOrchestrator.js';
import { fetchAllTalentsForSync, fetchCandidatesForJob } from './src/Core/management-flow/managementOrchestrator.js'; 
import { getFromCache, setToCache } from './src/utils/cache.service.js';
import { syncEntityCache } from './src/utils/sync.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;
const JOBS_CACHE_KEY = 'all_jobs_with_details';
const TALENTS_CACHE_KEY = 'all_talents';

// Função de sincronização de vagas (permanece igual)
const syncJobs = () => syncEntityCache(JOBS_CACHE_KEY, fetchAllJobsWithDetails);
const syncTalents = () => syncEntityCache(TALENTS_CACHE_KEY, fetchAllTalentsForSync);

// Função para pré-carregar candidatos (permanece igual)
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

// ==========================================================
// FUNÇÃO DE INICIALIZAÇÃO ASSÍNCRONA REESTRUTURADA
// ==========================================================
const startServer = async () => {
  // 1. Configurações básicas e síncronas primeiro
  configureLogger({ toFile: true });
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));
  log('--- INICIALIZAÇÃO DO SERVIDOR ---');

  // 2. INICIALIZA TODOS OS SERVIÇOS EM ORDEM
  initializeCache();
  initializeSessionService(memoryStorageAdapter);
  initializeAuthStorage(memoryStorageAdapter);
  log('✅ Serviços de cache, sessão e autenticação inicializados.');

  // 3. Realiza o login. Agora os serviços de armazenamento já estão prontos.
  const loginResult = await performLogin();
  if (!loginResult.success) {
    logError('Falha crítica no login. O servidor não pode continuar e será encerrado.');
    process.exit(1);
  }
  log('✅ Login bem-sucedido.');

   // ==========================================================
  // CORREÇÃO NA ORDEM DE EXECUÇÃO
  // ==========================================================
  log('Realizando a primeira sincronização de VAGAS...');
  //await syncJobs();
  log('✅ Sincronização de Vagas concluída.');

  log('Realizando a primeira sincronização de TALENTOS...');
  await syncTalents();
  log('✅ Sincronização de Talentos concluída.');
  
  // Agora que VAGAS E TALENTOS estão no cache, pré-carregamos os candidatos.
  //await prefetchAllCandidates();

  // Agenda as sincronizações futuras
  setInterval(syncJobs, 60000);
  setInterval(syncTalents, 60000);
  log('🔄 Sincronização periódica de Vagas e Talentos agendada a cada 60 segundos.');

  // Configura rotas e inicia o servidor
  app.use('/api', apiRoutes);
  log('✅ Rotas da API configuradas.');

  app.listen(PORT, () => {
    log(`🚀 Servidor rodando e ouvindo na porta ${PORT}`);
  });
};

startServer();