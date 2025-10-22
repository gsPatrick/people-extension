import { Sequelize } from 'sequelize';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { createRequire } from 'module'; // ✅ Necessário para importar módulos CommonJS

import dbConfig from '../config/database.js';
import scorecardModel from './scorecard.model.js';
import categoryModel from './category.model.js';
import criterionModel from './criterion.model.js';

const require = createRequire(import.meta.url);
const sqliteVss = require('sqlite-vss'); // ✅ Importa corretamente o módulo CommonJS

const env = process.env.NODE_ENV || 'development';
const config = dbConfig[env];

const db = {};

// Configuração do Sequelize com better-sqlite3
const sequelize = new Sequelize({ ...config, dialectModule: Database });

// ✅ Aguarda o carregamento da extensão VSS na conexão SQLite
sequelize.connectionManager.getConnection()
  .then(async (conn) => {
    await sqliteVss.load(conn);
    console.log('✅ Extensão sqlite-vss carregada na conexão.');
  })
  .catch(err => {
    console.error('❌ Erro ao carregar extensão sqlite-vss:', err);
  });

const modelDefinitions = [scorecardModel, categoryModel, criterionModel];

for (const modelDef of modelDefinitions) {
  const model = modelDef(sequelize);
  db[model.name] = model;
}

Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

export default db;
