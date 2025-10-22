// ARQUIVO COMPLETO: src/models/index.js

import { Sequelize } from 'sequelize';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';

// --- FONTE ÚNICA DA VERDADE PARA O CAMINHO DO BANCO DE DADOS ---
export const DB_PATH = path.resolve(process.cwd(), 'database.sqlite');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Garante que o diretório do banco de dados exista
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Inicializa o Sequelize com o caminho centralizado
export const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: DB_PATH, // <-- Usa a constante exportada
  logging: false,
  dialectModule: sqlite3,
});

const db = {};

// Função assíncrona para carregar os modelos e configurar o DB
const initializeModels = async () => {
  const files = fs.readdirSync(__dirname).filter(file => 
    (file.indexOf('.') !== 0) && (file !== path.basename(__filename)) && (file.slice(-9) === '.model.js')
  );

  for (const file of files) {
    const modelImporter = await import(new URL(file, import.meta.url).href);
    const model = modelImporter.default(sequelize);
    db[model.name] = model;
  }

  Object.keys(db).forEach(modelName => {
    if (db[modelName].associate) {
      db[modelName].associate(db);
    }
  });
};

await initializeModels();

db.sequelize = sequelize;
db.Sequelize = Sequelize;

export default db;