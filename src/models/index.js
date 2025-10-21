import { Sequelize } from 'sequelize';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Módulos dos models
import scorecardModel from './scorecard.model.js';
import categoryModel from './category.model.js';
import criterionModel from './criterion.model.js';

// Importa a configuração do banco de dados (ajuste o caminho se a estrutura for diferente)
import dbConfig from '../config/database.js';

// Configuração para lidar com __dirname em ES Modules, se necessário
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const env = process.env.NODE_ENV || 'development';
const config = dbConfig[env];

const db = {};

let sequelize;
if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, config);
}

// Inicializa cada model e o adiciona ao objeto 'db'
const models = [
  scorecardModel,
  categoryModel,
  criterionModel,
];

models.forEach(modelDefinition => {
  const model = modelDefinition(sequelize);
  db[model.name] = model;
});

// Executa o método 'associate' para cada modelo, se ele existir
// Isso constrói as relações (hasMany, belongsTo, etc.) entre as tabelas
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

// Exporta a instância do sequelize e os próprios models
db.sequelize = sequelize;
db.Sequelize = Sequelize;

export default db;