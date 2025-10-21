
'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
const config = require(__dirname + '/../config/database.js')[env];
const db = {};

// Inicializa a conexão com o banco de dados
const sequelize = new Sequelize(config.database, config.username, config.password, config);

// Carrega todos os arquivos de modelo do diretório atual
fs
  .readdirSync(__dirname)
  .filter(file => {
    return (file.indexOf('.') !== 0) && (file !== basename) && (file.slice(-3) === '.js');
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

// --- DEFINIÇÃO DAS ASSOCIAÇÕES ---

// Um Scorecard tem muitas Categorias
db.Scorecard.hasMany(db.Category, { as: 'categories', foreignKey: 'scorecardId' });
db.Category.belongsTo(db.Scorecard, { foreignKey: 'scorecardId' });

// Uma Categoria tem muitos Critérios
db.Category.hasMany(db.Criterion, { as: 'criteria', foreignKey: 'categoryId' });
db.Criterion.belongsTo(db.Category, { foreignKey: 'categoryId' });

// Executa a associação para cada modelo, se o método `associate` existir
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;