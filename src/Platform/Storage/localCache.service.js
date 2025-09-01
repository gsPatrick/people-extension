// CRIE O ARQUIVO: src/Platform/Storage/localCache.service.js

import sqlite3 from 'sqlite3';
import { log, error } from '../../utils/logger.service.js';

const DB_PATH = './local_cache.sqlite';
let db;

/**
 * Inicializa a conexão com o banco de dados SQLite e cria a tabela se não existir.
 * Deve ser chamado uma vez na inicialização do servidor.
 */
export const initializeCache = () => {
    db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
            error('Erro ao conectar ao banco de dados SQLite', err.message);
        } else {
            log('✅ Conectado ao banco de dados de cache local (SQLite).');
            // Garante que a tabela exista
            db.run(`CREATE TABLE IF NOT EXISTS raw_profiles (
                linkedin_username TEXT PRIMARY KEY,
                raw_data TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, (createErr) => {
                if (createErr) {
                    error('Erro ao criar a tabela raw_profiles', createErr.message);
                }
            });
        }
    });
};

/**
 * Salva ou atualiza os dados brutos de um perfil no cache.
 * @param {string} linkedinUsername - O username do LinkedIn (será a chave).
 * @param {object} rawData - O objeto JSON completo do scraping.
 */
export const saveRawProfile = (linkedinUsername, rawData) => {
    return new Promise((resolve, reject) => {
        if (!db || !linkedinUsername) return reject('Cache não inicializado ou username inválido.');
        
        const jsonData = JSON.stringify(rawData);
        // "INSERT OR REPLACE" (UPSERT): Insere se não existir, substitui se já existir.
        const sql = `INSERT OR REPLACE INTO raw_profiles (linkedin_username, raw_data) VALUES (?, ?)`;
        
        db.run(sql, [linkedinUsername, jsonData], function(err) {
            if (err) {
                error(`Erro ao salvar perfil ${linkedinUsername} no cache`, err.message);
                return reject(err);
            }
            log(`💾 Perfil bruto de ${linkedinUsername} salvo/atualizado no cache local.`);
            resolve();
        });
    });
};

/**
 * Busca os dados brutos de um perfil do cache.
 * @param {string} linkedinUsername - O username do LinkedIn.
 * @returns {Promise<object|null>} O objeto do perfil parseado ou null.
 */
export const getRawProfile = (linkedinUsername) => {
    return new Promise((resolve, reject) => {
        if (!db || !linkedinUsername) return reject('Cache não inicializado ou username inválido.');

        const sql = `SELECT raw_data FROM raw_profiles WHERE linkedin_username = ?`;
        db.get(sql, [linkedinUsername], (err, row) => {
            if (err) {
                error(`Erro ao buscar perfil ${linkedinUsername} do cache`, err.message);
                return reject(err);
            }
            if (row) {
                log(`HIT: Perfil bruto de ${linkedinUsername} encontrado no cache local.`);
                resolve(JSON.parse(row.raw_data));
            } else {
                log(`MISS: Perfil bruto de ${linkedinUsername} NÃO encontrado no cache local.`);
                resolve(null);
            }
        });
    });
};