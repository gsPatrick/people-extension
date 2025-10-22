// ARQUIVO COMPLETO: src/models/index.js

import { Sequelize } from 'sequelize';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';

// --- A MÁGICA ACONTECE AQUI ---
// Não criamos a instância do Sequelize ainda. Apenas preparamos as variáveis.
export let sequelize = null; // <-- MUDANÇA CRÍTICA: Inicializa como nulo.
const db = {};
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DB_PATH = path.resolve(process.cwd(), 'database.sqlite');

/**
 * Função que será chamada pelo server.js para inicializar a conexão e os modelos.
 * Isso garante que a limpeza do arquivo do DB já tenha ocorrido.
 */
export const initializeSequelize = async () => {
    // Só cria a instância do Sequelize quando esta função é chamada.
    sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: DB_PATH,
        logging: false,
        dialectModule: sqlite3,
    });

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

    db.sequelize = sequelize;
    db.Sequelize = Sequelize;

    return db; // Retorna o objeto db configurado.
};

export default db;