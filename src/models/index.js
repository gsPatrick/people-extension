import { Sequelize } from 'sequelize';
import path from 'path';
import fs from 'fs';

// Caminho do banco SQLite (para desenvolvimento/local)
const DB_PATH = path.resolve('database/database.sqlite');

// Garante que a pasta exista
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let sequelize;

try {
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: DB_PATH,
    logging: false,
  });

  console.log('--- INICIALIZAÇÃO DO BANCO DE DADOS (SQLite + Sequelize) ---');
  console.log('Sincronizando models com o banco de dados (alter: true)...');

  await sequelize.sync({ alter: true });

  console.log('✅ Banco de dados sincronizado com sucesso.');
} catch (error) {
  console.error('❌ ERRO: Falha crítica ao sincronizar os models/VSS com o banco de dados.', error);
}

// Exporta o Sequelize para os models
export { sequelize };
