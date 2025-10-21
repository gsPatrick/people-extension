import { Sequelize } from 'sequelize';
import path from 'path';
import { fileURLToPath } from 'url';

import dbConfig from '../config/database.js';
import scorecardModel from './scorecard.model.js';
import categoryModel from './category.model.js';
import criterionModel from './criterion.model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const env = process.env.NODE_ENV || 'development';
const config = dbConfig[env];

const db = {};

let sequelize;
// **LÓGICA DE CONEXÃO CORRIGIDA E ROBUSTA**
// Se uma URL de conexão estiver definida no ambiente (típico de produção), use-a.
if (config.url) {
  sequelize = new Sequelize(config.url, config);
} 
// Caso contrário, use os campos individuais (típico de desenvolvimento).
else {
  sequelize = new Sequelize(config.database, config.username, config.password, config);
}

// Lista de todas as definições de models
const modelDefinitions = [
  scorecardModel,
  categoryModel,
  criterionModel,
];

// Inicializa cada model e o armazena no objeto 'db'
for (const modelDef of modelDefinitions) {
  const model = modelDef(sequelize);
  db[model.name] = model;
}

// Executa o método estático 'associate' para construir as relações
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

// Exporta a conexão e os models
db.sequelize = sequelize;
db.Sequelize = Sequelize;

export default db;