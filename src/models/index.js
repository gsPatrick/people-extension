import { Sequelize } from 'sequelize';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { Vss } from 'sqlite-vss'; // Importa a extensão VSS

import dbConfig from '../config/database.js';
import scorecardModel from './scorecard.model.js';
import categoryModel from './category.model.js';
import criterionModel from './criterion.model.js';

const env = process.env.NODE_ENV || 'development';
const config = dbConfig[env];

const db = {};

// Configuração do Sequelize para usar 'better-sqlite3'
const sequelize = new Sequelize({ ...config, dialectModule: Database });

// **CARREGAR A EXTENSÃO VSS**
// Carrega a extensão de busca vetorial na conexão do banco de dados
Vss.load(sequelize.dialect.connectionManager.connections.default);
console.log('✅ Extensão sqlite-vss carregada na conexão.');

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