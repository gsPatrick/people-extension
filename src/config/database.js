import 'dotenv/config';
import path from 'path';

// O banco de dados será um arquivo chamado 'database.sqlite' na raiz do projeto.
const storagePath = path.join(process.cwd(), 'database.sqlite');

const config = {
  development: {
    dialect: 'sqlite',
    storage: storagePath, // Caminho para o arquivo do banco de dados
    logging: false,
  },
  production: {
    dialect: 'sqlite',
    storage: storagePath, // Em produção, você pode querer um caminho diferente
    logging: false,
  }
};

export default config;