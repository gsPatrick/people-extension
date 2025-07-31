// src/Server/server.js (ou o nome do seu arquivo principal do servidor)

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { configureLogger, log, error as logError } from './utils/logger.service.js';
import { performLogin } from './Core/Auth-Flow/authOrchestrator.js';
import apiRoutes from './Server/apiRoutes.js';
import path from 'path'; // Importar path
import { fileURLToPath } from 'url'; // Para __dirname em módulos ES

// Para __dirname em módulos ES
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurar o logger
configureLogger({ toFile: true });

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// NOVO: Configurar o Express para servir arquivos estáticos da pasta 'public'
// Isso fará com que 'meu-projeto-backend/public/data/linkedins.csv' seja acessível via '/data/linkedins.csv'
app.use(express.static(path.join(__dirname, 'public')));


// Rotas da API
app.use('/api', apiRoutes);

// Autenticação na InHire na inicialização do servidor
performLogin()
  .then(result => {
    if (result.success) {
      log('✅ Servidor logado na InHire com sucesso na inicialização.');
    } else {
      logError('❌ Falha ao logar na InHire na inicialização:', result.error);
    }
  })
  .catch(err => {
    logError('❌ Erro crítico ao tentar logar na InHire na inicialização:', err);
  });

// Iniciar o servidor
app.listen(PORT, () => {
  log(`🚀 Servidor rodando e ouvindo na porta ${PORT}`);
});