import { Sequelize } from 'sequelize';
import path from 'path';
import { fileURLToPath } from 'url';

// Importa a configuração do banco de dados (agora funciona corretamente)
import dbConfig from '../config/database.js';

// Importa as definições dos models
import scorecardModel from './scorecard.model.js';
import categoryModel from './category.model.js';
import criterionModel from './criterion.model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const env = process.env.NODE_ENV || 'development';
const config = dbConfig[env];

const db = {};

let sequelize;
// Cria a instância do Sequelize
if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
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

// Executa o método estático 'associate' para construir as relações entre as tabelas
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

// Exporta a conexão e os models para serem usados em outros lugares da aplicação
db.sequelize = sequelize;
db.Sequelize = Sequelize;

export default db;