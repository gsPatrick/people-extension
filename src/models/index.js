import { Sequelize } from 'sequelize';
import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';

// Caminho do banco SQLite
const DB_PATH = path.resolve('database/database.sqlite');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Inicializa o Sequelize
export const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: DB_PATH,
  logging: false,
  dialectModule: sqlite3, // garante que use o sqlite3 nativo
});

// Função para carregar a extensão VSS
const loadVssExtension = async () => {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(err);

      // Caminho para a biblioteca vss0.so/dll/dylib
      const vssPath = path.resolve('node_modules/sqlite-vss/build/Release/vss0.node');

      db.loadExtension(vssPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });
};

const initializeDatabase = async () => {
  console.log('--- INICIALIZAÇÃO DO BANCO DE DADOS (SQLite + Sequelize) ---');
  
  try {
    await loadVssExtension();
    console.log('✅ Extensão VSS carregada com sucesso.');

    await sequelize.sync({ alter: true });
    console.log('✅ Models sincronizados com sucesso.');

    // Cria a tabela virtual VSS (agora que a extensão está carregada)
    await sequelize.query(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vss_criteria USING vss0(
        embedding(1536)
      );
    `);
    console.log('✅ Tabela virtual VSS criada com sucesso.');
  } catch (error) {
    console.error('❌ ERRO ao inicializar o banco/VSS:', error);
    process.exit(1);
  }
};

// Inicializa
await initializeDatabase();
