// ARQUIVO COMPLETO: src/models/index.js

import { Sequelize } from 'sequelize';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dbConfig from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = dbConfig.development; 
const sequelize = new Sequelize(config.database, config.username, config.password, config);

const db = {};

const initializeModels = async () => {
  const files = fs.readdirSync(__dirname).filter(file => 
    (file.indexOf('.') !== 0) && (file !== path.basename(__filename)) && (file.slice(-9) === '.model.js')
  );

  console.log('[DEBUG INDEX.JS] Arquivos de modelo encontrados:', files); // DEBUG
  
  for (const file of files) {
    console.log(`[DEBUG INDEX.JS] Tentando importar: ${file}`); // DEBUG
    const modelImporter = await import(new URL(file, import.meta.url).href);
    const model = modelImporter.default(sequelize);
    console.log(`[DEBUG INDEX.JS] Modelo carregado: ${model.name}`); // DEBUG
    db[model.name] = model;
  }

  Object.keys(db).forEach(modelName => {
    if (db[modelName].associate) {
      db[modelName].associate(db);
    }
  });

  console.log('[DEBUG INDEX.JS] Modelos finais no objeto db:', Object.keys(db)); // DEBUG
};

await initializeModels();

db.sequelize = sequelize;
db.Sequelize = Sequelize;

export default db;
export { sequelize };