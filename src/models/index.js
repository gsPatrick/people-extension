import { Sequelize } from 'sequelize';
import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';

// Define o caminho para o arquivo do banco de dados na raiz do projeto
const DB_PATH = path.resolve(process.cwd(), 'database.sqlite');
const modelsDir = path.dirname(new URL(import.meta.url).pathname);

// Garante que o diretório do banco de dados exista antes de tentar conectar
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Inicializa o Sequelize, mas não realiza a sincronização aqui
export const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: DB_PATH,
  logging: false, // Alterar para `console.log` para depurar queries
  dialectModule: sqlite3,
});

const db = {};

// Carrega dinamicamente todos os arquivos de modelo do diretório atual
fs.readdirSync(modelsDir)
  .filter(file => {
    // Filtra para incluir apenas arquivos de modelo JavaScript, excluindo o próprio index.js
    return (file.indexOf('.') !== 0) && (file !== 'index.js') && (file.slice(-9) === '.model.js');
  })
  .forEach(async (file) => {
    // Importa dinamicamente, inicializa o modelo com a instância do sequelize e o adiciona ao objeto 'db'
    const modelImporter = await import(new URL(file, import.meta.url).href);
    const model = modelImporter.default(sequelize);
    db[model.name] = model;
  });

// Executa o método 'associate' de cada modelo, se ele existir, para criar as associações
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

export default db;