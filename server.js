// meu-projeto-backend/server.js

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';          // Importar path
import { fileURLToPath } from 'url'; // Para __filename e __dirname em módulos ES

// Para resolver __filename e __dirname em módulos ES
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Importando o logger (CORREÇÃO DE CAMINHO AQUI)
import { configureLogger, log, error as logError } from './src/utils/logger.service.js';

// Importando os inicializadores e o arquivo de rotas (VERIFIQUE CAMINHOS)
import { memoryStorageAdapter } from './src/Platform/Storage/memoryStorage.adapter.js'; // Caminho provavelmente OK
import { initializeSessionService } from './src/Core/session.service.js';            // Caminho provavelmente OK
import { initializeAuthStorage } from './src/Inhire/Auth/authStorage.service.js';    // Caminho provavelmente OK
import { performLogin } from './src/Core/Auth-Flow/authOrchestrator.js';            // Caminho provavelmente OK
import apiRoutes from './src/routes/apiRoutes.js';                                   // Caminho provavelmente OK (conforme seu snippet anterior)
import { initializeCache } from './src/Platform/Storage/localCache.service.js'; // <<< NOVA IMPORTAÇÃO


const app = express();
const PORT = process.env.PORT || 4000;

// Configurar o logger no início
configureLogger({ toFile: true });


// Middlewares essenciais
app.use(cors()); // Permite requisições de outras origens (sua extensão)
app.use(express.json()); // Habilita o parsing de JSON no corpo das requisições

// NOVO: Configurar o Express para servir arquivos estáticos da pasta 'public'
// Isso fará com que 'meu-projeto-backend/public/data/linkedins.csv' seja acessível via '/data/linkedins.csv'
app.use(express.static(path.join(__dirname, 'public')));


// ---- INICIALIZAÇÃO DO SERVIÇO DE BACKEND ----
// O servidor, ao iniciar, se prepara para se comunicar com as APIs externas.
initializeCache(); // <<< NOVA LINHA: Inicializa o banco SQLite
initializeSessionService(memoryStorageAdapter);
initializeAuthStorage(memoryStorageAdapter);

performLogin().then(result => {
  if (result.success) {
    log('✅ Servidor logado na InHire com sucesso na inicialização.'); // Usando 'log'
  } else {
    logError('❌ Falha ao logar na InHire na inicialização:', result.error); // Usando 'logError'
  }
}).catch(err => {
  logError('❌ Erro crítico ao tentar logar na InHire na inicialização:', err); // Usando 'logError'
});

// ===================================================================
//                          ROTAS DA API
// ===================================================================

// Rota de "saúde" para verificar se a API está online
app.get('/', (req, res) => {
  res.status(200).json({ status: 'online', message: 'API da Extensão InHire Helper está no ar!' });
});

// Delega todas as rotas que começam com /api para o nosso arquivo de rotas
app.use('/api', apiRoutes);


// ---- INICIANDO O SERVIDOR ----
app.listen(PORT, () => {
  log(`🚀 Servidor rodando e ouvindo na porta ${PORT}`); // Usando 'log'
});